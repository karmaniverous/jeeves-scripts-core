/**
 * @module meetings/lib/fathom-html
 *
 * Pure HTML helpers for Fathom share pages: decode entities, pull the
 * inner HTML of the hidden transcript div, and convert HTML to plain
 * text.
 */

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (full, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return full;
      }
    })
    .replace(/&#(\d+);/g, (full, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return full;
      }
    });
}

export function extractHiddenDivInnerHtml(html: string): string | null {
  const marker = '<div style="display:none;">Meeting Purpose';
  let start = html.indexOf(marker);

  // If marker not found, fall back to first div with style display:none
  if (start === -1) {
    const re =
      /<div\b[^>]*\bstyle\s*=\s*"\s*display\s*:\s*none\s*;?\s*"[^>]*>/i;
    const m = re.exec(html);
    if (!m) return null;
    start = m.index;
  }

  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;

  const first = tagRe.exec(html);
  if (first?.index !== start || first[0].startsWith('</')) return null;

  const startTagEnd = first.index + first[0].length;
  let depth = 1;
  let endTagStart = -1;

  while (depth > 0) {
    const m = tagRe.exec(html);
    if (!m) break;
    if (m[0].startsWith('</')) depth--;
    else depth++;

    if (depth === 0) {
      endTagStart = m.index;
      break;
    }
  }

  if (endTagStart === -1) return null;
  return html.slice(startTagEnd, endTagStart);
}

export function htmlToText(html: string): string {
  let s = html;

  // Newline-preserving conversions
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n');
  s = s.replace(/<\s*li\b[^>]*>/gi, '- ');

  // Strip remaining tags
  s = s.replace(/<[^>]*>/g, '');

  s = decodeHtmlEntities(s);

  // Normalize whitespace
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]+/g, ' ');

  return s.trim() + '\n';
}
