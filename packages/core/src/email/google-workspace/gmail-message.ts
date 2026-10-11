/**
 * @module email/google-workspace/gmail-message
 *
 * Pure reading of a Gmail API message (`gog gmail thread get --json`):
 * headers, labels, direction and attachments, the cache entry built from
 * it, and the thread's newest internal date.
 */

import {
  type GmailHeader,
  type GmailPayloadPart,
  headerValue,
} from '../../lib/email.js';
import type { CacheMessage } from '../email-cache.js';

/** A message in a `gog gmail thread get --json` response. */
export interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPayloadPart & { headers?: GmailHeader[] };
  labelIds?: string[];
  snippet?: string;
}

/** The fields of a Gmail message the fetcher uses. */
export interface ParsedGmailMessage {
  messageId: string;
  /** `internalDate` as epoch ms, or null when absent. */
  internalDateMs: number | null;
  from: string;
  to: string;
  cc: string;
  /** The Subject header, else the thread subject. */
  subject: string;
  /** The Date header ('' when absent). */
  date: string;
  labels: string[];
  /** `outgoing` when labelled SENT. */
  direction: 'incoming' | 'outgoing';
  snippet: string;
  attachments: CacheMessage['attachments'];
}

/** Every part with a filename and a body, depth first. */
export function collectAttachments(
  payload: GmailPayloadPart | undefined,
): CacheMessage['attachments'] {
  const atts: CacheMessage['attachments'] = [];
  if (payload) {
    const walk = (p: GmailPayloadPart): void => {
      if (p.filename && p.body)
        atts.push({
          filename: p.filename,
          mimeType: p.mimeType ?? '',
          size: p.body.size ?? 0,
        });
      p.parts?.forEach(walk);
    };
    walk(payload);
  }
  return atts;
}

/**
 * Read a Gmail message.
 *
 * @param fallbackSubject - used when the message has no Subject header
 * @returns null when the message has no id
 */
export function parseGmailMessage(
  m: GmailMessage,
  fallbackSubject: string,
): ParsedGmailMessage | null {
  const messageId = m.id || '';
  if (!messageId) return null;
  const hdrs = m.payload?.headers ?? [];
  const labels = m.labelIds ?? [];
  return {
    messageId,
    internalDateMs: m.internalDate ? Number(m.internalDate) : null,
    from: headerValue(hdrs, 'From'),
    to: headerValue(hdrs, 'To'),
    cc: headerValue(hdrs, 'Cc'),
    subject: headerValue(hdrs, 'Subject') || fallbackSubject,
    date: headerValue(hdrs, 'Date'),
    labels,
    direction: labels.includes('SENT') ? 'outgoing' : 'incoming',
    snippet: m.snippet ?? '',
    attachments: collectAttachments(m.payload),
  };
}

/** The individual addresses in From/To/Cc header values (comma-split, trimmed). */
export const addressesOf = (...headers: string[]): string[] =>
  headers.flatMap((a) =>
    a
      ? a
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  );

/** The thread cache entry for a message. */
export const toCacheMessage = (p: ParsedGmailMessage): CacheMessage => ({
  messageId: p.messageId,
  from: p.from,
  to: p.to,
  cc: p.cc,
  date: p.date || null,
  internalDateMs: p.internalDateMs,
  labels: p.labels,
  snippet: p.snippet,
  hasAttachments: p.attachments.length > 0,
  attachments: p.attachments,
});

/** The newest `internalDate` among `messages`, starting from `start`. */
export function latestInternalDateMs(
  messages: readonly GmailMessage[],
  start: number | null,
): number | null {
  let maxI = start;
  for (const m of messages) {
    const ms = m.internalDate ? Number(m.internalDate) : null;
    if (ms != null && (maxI == null || ms > maxI)) maxI = ms;
  }
  return maxI;
}
