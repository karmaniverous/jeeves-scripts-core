/**
 * @module email
 *
 * Gmail parsing utilities — header extraction, body decoding, and
 * attachment metadata from Gmail API response payloads.
 *
 * Used by the email pipeline (email/download.ts, email/drain-updates.ts)
 * to parse raw Gmail message structures into usable text and metadata.
 *
 * No config dependencies — operates on Gmail API response objects.
 */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayloadPart[];
}

export interface ExtractedBody {
  text: string;
  html: string;
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string | null;
}

/**
 * Extract a header value from a Gmail headers array (case-insensitive).
 */
export function headerValue(
  headers: GmailHeader[] | undefined,
  name: string,
): string {
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/**
 * Decode Gmail URL-safe base64 to UTF-8.
 */
function decodeGmailBase64(b64: string): string {
  if (!b64) return '';
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64').toString('utf8');
}

/**
 * Extract text and HTML from a Gmail payload (recursive).
 */
export function extractTextFromPayload(
  payload: GmailPayloadPart | null | undefined,
): ExtractedBody {
  if (!payload || typeof payload !== 'object') return { text: '', html: '' };

  const out: ExtractedBody = { text: '', html: '' };
  const mime = (payload.mimeType ?? '').toLowerCase();

  if (mime.startsWith('text/plain') && payload.body?.data) {
    out.text = decodeGmailBase64(payload.body.data);
    return out;
  }

  if (mime.startsWith('text/html') && payload.body?.data) {
    out.html = decodeGmailBase64(payload.body.data);
    return out;
  }

  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) {
    const sub = extractTextFromPayload(p);
    if (!out.text && sub.text) out.text = sub.text;
    if (!out.html && sub.html) out.html = sub.html;
    if (out.text && out.html) break;
  }

  return out;
}

/**
 * Extract attachment metadata from a Gmail payload (recursive).
 */
export function extractAttachments(
  payload: GmailPayloadPart | null | undefined,
): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function walk(part: GmailPayloadPart | null | undefined): void {
    if (!part || typeof part !== 'object') return;

    const filename = part.filename ?? '';
    const mimeType = part.mimeType ?? '';

    if (filename && part.body) {
      attachments.push({
        filename,
        mimeType,
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId ?? null,
      });
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);
  return attachments;
}
