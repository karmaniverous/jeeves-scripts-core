/**
 * @module email-html
 *
 * Plain-text rendering of HTML email bodies, for messages that carry no
 * `text/plain` part (e.g. Apple Mail rich-link messages, which send
 * `multipart/related` with only `text/html` plus inline images).
 *
 * Deliberately small and dependency-free: drops non-content elements
 * (head, style, script, comments), keeps line structure, keeps link
 * targets (`label <url>`) so URLs survive, strips the remaining tags and
 * decodes entities. Output is for an LLM reader, not for display.
 */

import { extractTextFromPayload, type GmailPayloadPart } from './email.js';

function decodeEntities(s: string): string {
  const fromCode = (full: string, code: number): string => {
    try {
      return String.fromCodePoint(code);
    } catch {
      return full;
    }
  };
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (full, hex: string) =>
      fromCode(full, parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (full, dec: string) =>
      fromCode(full, parseInt(dec, 10)),
    )
    .replace(/&amp;/gi, '&');
}

/** Visible text of an anchor's inner HTML, whitespace-collapsed. */
function anchorLabel(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render an HTML email body as plain text.
 *
 * @returns Trimmed text; '' when the HTML has no visible content.
 */
export function emailHtmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // Links: keep the target so URLs survive; avoid "url <url>" repeats.
  s = s.replace(
    /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_full, _q: string, href: string, inner: string) => {
      const url = decodeEntities(href).trim();
      const label = anchorLabel(inner);
      if (!url || /^(mailto:|cid:|#)/i.test(url)) return label;
      if (!label || label === url) return ` ${url} `;
      // Parentheses, not angle brackets: the tag stripper below would
      // eat `<url>`.
      return ` ${label} (${url}) `;
    },
  );
  s = s.replace(/<\s*br\b[^>]*>/gi, '\n');
  s = s.replace(
    /<\s*\/?\s*(p|div|h[1-6]|li|tr|table|blockquote)\b[^>]*>/gi,
    '\n',
  );
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, '\n');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * The plain-text body of a Gmail payload: the `text/plain` part when it
 * has content, otherwise the `text/html` part rendered as text.
 */
export function extractPlainBody(
  payload: GmailPayloadPart | null | undefined,
): string {
  const { text, html } = extractTextFromPayload(payload);
  if (text.trim()) return text;
  return html ? emailHtmlToText(html) : '';
}
