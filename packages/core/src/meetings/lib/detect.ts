/**
 * @module detect
 *
 * Meeting detection helpers -- subject/from/snippet matching, title
 * normalization, participant extraction, Fathom URL detection, and
 * meeting ID generation.
 *
 * Used by extract and migration scripts to identify meeting-related
 * emails and normalize their metadata before package creation.
 */

import crypto from 'node:crypto';

import type { FathomKind } from './meeting-schema.js';

// ── Fathom URL patterns ─────────────────────────────────────────────

const FATHOM_SHARE_RE =
  /https?:\/\/(?:www\.)?fathom\.video\/share\/[^\s"'<>]+/gi;
const FATHOM_CALLS_RE =
  /https?:\/\/(?:www\.)?fathom\.video\/calls\/[^\s"'<>]+/gi;

/** UTM / tracking params to strip from Fathom URLs. */
const UTM_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'fbclid',
  'gclid',
]);

// ── Fathom URL helpers ──────────────────────────────────────────────

export interface FathomDetection {
  kind: FathomKind;
  url: string;
}

/**
 * Detect Fathom URLs in text content (body.text or body.html).
 * Returns the best detection per spec section 5 precedence:
 *   1. share link present → share
 *   2. only calls link → call
 *   3. no Fathom URL → null
 */
export function detectFathomUrl(text: string): FathomDetection | null {
  if (!text) return null;

  const shareMatches = text.match(FATHOM_SHARE_RE);
  if (shareMatches && shareMatches.length > 0) {
    return { kind: 'share', url: normalizeFathomUrl(shareMatches[0]) };
  }

  const callsMatches = text.match(FATHOM_CALLS_RE);
  if (callsMatches && callsMatches.length > 0) {
    return { kind: 'call', url: normalizeFathomUrl(callsMatches[0]) };
  }

  return null;
}

/**
 * Normalize a Fathom URL — strip UTM parameters and tracking junk.
 */
export function normalizeFathomUrl(rawUrl: string): string {
  try {
    // Fathom links often appear in HTML as `&amp;`-escaped URLs.
    // Decode the common cases before URL parsing so query params
    // are interpreted correctly.
    const decodedUrl = rawUrl.replace(/&amp;/g, '&').replace(/&#38;/g, '&');

    const u = new URL(decodedUrl);
    const keysToDelete: string[] = [];
    for (const key of u.searchParams.keys()) {
      if (UTM_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      u.searchParams.delete(key);
    }
    // Remove trailing hash if empty
    if (u.hash === '#') u.hash = '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Detect Fathom URL from both text and HTML bodies.
 * Share link in either body takes precedence.
 */
export function detectFathomFromBodies(
  bodyText: string,
  bodyHtml: string,
): FathomDetection | null {
  // Check text first for share links
  const textDetection = detectFathomUrl(bodyText);
  if (textDetection?.kind === 'share') return textDetection;

  // Check HTML for share links
  const htmlDetection = detectFathomUrl(bodyHtml);
  if (htmlDetection?.kind === 'share') return htmlDetection;

  // Fall back to calls links
  if (textDetection?.kind === 'call') return textDetection;
  if (htmlDetection?.kind === 'call') return htmlDetection;

  return null;
}

// ── Existing helpers ────────────────────────────────────────────────

export function isMeetingish(
  subject: string,
  from: string,
  snippet: string,
): boolean {
  const s = `${subject} ${from} ${snippet}`.toLowerCase();
  return (
    s.includes('meeting summary') ||
    s.includes('meeting report') ||
    s.includes('meeting recap') ||
    s.includes('meeting notes') ||
    s.includes('notes:') ||
    s.includes('recap for') ||
    s.includes('recap of your meeting') ||
    s.includes('pre-read for your upcoming meeting') ||
    s.includes('gemini-notes@google.com') ||
    s.includes('apollo') ||
    s.includes('read.ai') ||
    s.includes('@e.read.ai')
  );
}

/**
 * Detect meeting source from email metadata and body content.
 *
 * URL-based Fathom detection outranks sender/subject heuristics
 * (spec section 5). Pass body text/HTML when available for URL scan.
 */
export function detectMeetingSource(
  from: string,
  subject: string,
  bodyText?: string,
  bodyHtml?: string,
): string {
  // URL-based Fathom detection takes precedence (spec section 5)
  if (bodyText || bodyHtml) {
    const fathom = detectFathomFromBodies(bodyText ?? '', bodyHtml ?? '');
    if (fathom) return 'fathom';
  }

  const f = (from || '').toLowerCase();
  const s = (subject || '').toLowerCase();
  if (f.includes('gemini-notes@google.com')) return 'gemini';
  if (
    f.includes('support@apollo.io') &&
    (s.includes('meeting summary') || s.includes('meeting recap'))
  )
    return 'apollo';
  if (f.includes('apollo.io') && !s.includes('meeting')) return 'not-meeting';
  if (f.includes('@e.read.ai') || f.includes('read.ai')) return 'read-ai';
  if (f.includes('fathom')) return 'not-meeting';
  if (s.startsWith('fw:') || s.startsWith('fwd:')) return 'forwarded';
  return 'unknown';
}

export function normalizeMeetingTitle(subject: string): string {
  let title = subject || '';
  title = title.replace(/^(re:|fwd?:|fw:)\s*/gi, '');
  title = title.replace(
    /^(meeting summary for|meeting recap for|recap of your meeting|notes for|meeting notes for|summary of|recap for)[\s:]+/gi,
    '',
  );
  title = title.replace(/\s*[-–]\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/i, '');
  title = title.replace(/\s*on\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/i, '');
  return title.trim().toLowerCase();
}

export function parseEmailAddress(fromHeader: string): string {
  const m = (fromHeader || '').match(/<([^>]+)>/);
  return m ? m[1].toLowerCase() : (fromHeader || '').toLowerCase().trim();
}

export function parseDateToYmd(
  dateStr: string | null,
  internalDateMs: number | null,
): string {
  try {
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    if (internalDateMs) {
      const d = new Date(internalDateMs);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  } catch {
    // Fall through
  }
  return new Date().toISOString().slice(0, 10);
}

export function extractParticipants(bodyText: string, from: string): string[] {
  const emails = new Set<string>();
  const fromEmail = parseEmailAddress(from);
  if (fromEmail && fromEmail.includes('@')) emails.add(fromEmail);
  const matches =
    (bodyText || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ??
    [];
  for (const m of matches) {
    const email = m.toLowerCase();
    if (
      email.includes('noreply') ||
      email.includes('no-reply') ||
      email.includes('notifications') ||
      email.includes('mailer')
    )
      continue;
    emails.add(email);
  }
  return Array.from(emails);
}

export function findGeminiLink(text: string): string | null {
  const s = text || '';
  const m = s.match(
    /https?:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+[^\s\n"']*/i,
  );
  return m ? m[0] : null;
}

function sha256Short(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

export function generateMeetingId(
  title: string,
  date: string,
  participants: string[],
): string {
  const normalized = [
    normalizeMeetingTitle(title),
    date,
    participants.slice(0, 3).sort().join(','),
  ].join('|');
  return sha256Short(normalized);
}
