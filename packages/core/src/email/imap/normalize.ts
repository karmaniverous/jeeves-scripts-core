/**
 * @module normalize
 *
 * Maps raw imapflow FetchMessageObject + mailparser ParsedMail into a
 * stable NormalizedMessage abstraction. Consumers (key-resolver, account-types)
 * operate on NormalizedMessage exclusively, decoupled from the IMAP library.
 *
 * Input: FetchMessageObject (uid, flags, threadId, emailId, labels, source)
 * from imapflow fetch + ParsedMail from mailparser simpleParser.
 * Output: NormalizedMessage with precomputed threadRoot and snippet fields.
 */

import type { FetchMessageObject } from 'imapflow';
import type { AddressObject, ParsedMail } from 'mailparser';

// ── Types ────────────────────────────────────────────────────────────

export interface NormalizedMessage {
  uid: number;
  flags: string[];
  headers: {
    'message-id': string;
    references: string;
    'in-reply-to': string;
    from: string;
    to: string;
    cc: string;
    subject: string;
    date: string;
  };
  /** Extension values from provider-specific IMAP fetch items. */
  extensions: Record<string, string | string[]>;
  internalDate: Date;
  body: { text: string; html: string };
  attachments: Array<{ filename: string; mimeType: string; size: number }>;
  computed: {
    /** First Message-ID in References header, or own Message-ID. */
    threadRoot: string;
    /** First 200 chars of plain-text body, whitespace-normalized. */
    snippet: string;
  };
}

// ── Internal helpers ──────────────────────────────────────────────────

function addressText(
  addr: AddressObject | AddressObject[] | undefined,
): string {
  if (!addr) return '';
  const arr = Array.isArray(addr) ? addr : [addr];
  return arr
    .map((a) => a.text)
    .filter(Boolean)
    .join(', ');
}

function computeThreadRoot(mail: ParsedMail): string {
  const refs = mail.references;
  if (refs) {
    const arr = Array.isArray(refs) ? refs : refs.trim().split(/\s+/);
    const first = arr.find((r) => r.trim().length > 0);
    if (first) return first.trim();
  }
  return mail.messageId ?? '';
}

export function generateSnippet(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function getRawDateHeader(mail: ParsedMail): string {
  const line = mail.headerLines.find((l) => l.key === 'date');
  if (line) {
    return line.line.replace(/^[^:]+:\s*/, '').trim();
  }
  return mail.date?.toUTCString() ?? '';
}

function buildExtensions(
  fetch: FetchMessageObject,
): Record<string, string | string[]> {
  const ext: Record<string, string | string[]> = {};
  // imapflow exposes Gmail X-GM-THRID as threadId (string decimal)
  if (fetch.threadId != null) {
    ext['x-gm-thrid'] = fetch.threadId;
  }
  // imapflow exposes Gmail X-GM-MSGID as emailId (string decimal)
  if (fetch.emailId != null) {
    ext['x-gm-msgid'] = fetch.emailId;
  }
  // imapflow exposes Gmail X-GM-LABELS as labels (Set<string>)
  if (fetch.labels != null) {
    ext['x-gm-labels'] = [...fetch.labels];
  }
  return ext;
}

function resolveInternalDate(fetch: FetchMessageObject): Date {
  const d = fetch.internalDate;
  if (d instanceof Date) return d;
  if (typeof d === 'string') return new Date(d);
  return new Date();
}

// ── Public normalizer ─────────────────────────────────────────────────

/**
 * Convert a raw imapflow FetchMessageObject + mailparser ParsedMail into
 * a NormalizedMessage. Call after `simpleParser(fetch.source)` resolves.
 */
export function normalizeMessage(
  fetch: FetchMessageObject,
  mail: ParsedMail,
): NormalizedMessage {
  const flags = fetch.flags ? [...fetch.flags] : [];
  const threadRoot = computeThreadRoot(mail);
  const snippet = generateSnippet(mail.text);

  return {
    uid: fetch.uid,
    flags,
    headers: {
      'message-id': mail.messageId ?? '',
      references: Array.isArray(mail.references)
        ? mail.references.join(' ')
        : (mail.references ?? ''),
      'in-reply-to': mail.inReplyTo ?? '',
      from: mail.from?.text ?? '',
      to: addressText(mail.to),
      cc: addressText(mail.cc),
      subject: mail.subject ?? '',
      date: getRawDateHeader(mail),
    },
    extensions: buildExtensions(fetch),
    internalDate: resolveInternalDate(fetch),
    body: {
      text: mail.text ?? '',
      html: typeof mail.html === 'string' ? mail.html : '',
    },
    attachments: mail.attachments
      .filter((a) => !a.related)
      .map((a) => ({
        filename: a.filename ?? '',
        mimeType: a.contentType,
        size: a.size,
      })),
    computed: { threadRoot, snippet },
  };
}
