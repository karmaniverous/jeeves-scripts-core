/**
 * @module google-drive/lib/strip-images
 *
 * Remove inline base64 images from converted text. Office conversions
 * (and some Google Docs exports) embed every picture as a `data:` URI,
 * which turns a few pages of prose into megabytes of base64 that is
 * useless to search and synthesis and expensive to embed. Each image is
 * replaced with a short placeholder that keeps its alt text, so the
 * reader still knows a picture was there.
 */

/**
 * A base64 image `data:` URI inside a delimited context (Markdown parens,
 * HTML attribute quotes), where the payload may wrap across lines.
 */
const DATA_URI = String.raw`data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]*`;

/** A bare base64 image `data:` URI: the payload ends at whitespace. */
const BARE_DATA_URI_SOURCE = String.raw`data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]*`;

/** Markdown image whose target is a data URI: `![alt](data:...)`. */
const MARKDOWN_IMAGE = new RegExp(
  String.raw`!\[([^\]]*)\]\(\s*${DATA_URI}(?:\s+"[^"]*")?\s*\)`,
  'g',
);

/** HTML `<img>` tag whose `src` is a data URI. */
const HTML_IMAGE = new RegExp(
  String.raw`<img\b[^>]*?\bsrc\s*=\s*["']${DATA_URI}["'][^>]*>`,
  'gi',
);

/** `alt="..."` inside an `<img>` tag. */
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i;

/** Any remaining data URI (reference definitions, bare text). */
const BARE_DATA_URI = new RegExp(BARE_DATA_URI_SOURCE, 'g');

/** Placeholder text for one removed image. */
function placeholder(alt: string | undefined): string {
  const label = alt?.replace(/\s+/g, ' ').trim();
  return label ? `[image: ${label}]` : '[image]';
}

/**
 * Replace every inline base64 image in `text` with a placeholder.
 *
 * @param text - Converted document text (Markdown, HTML fragments, plain).
 * @returns The text with data-URI images replaced; unchanged when none.
 */
export function stripEmbeddedImages(text: string): string {
  if (!text.includes('data:image/')) return text;
  return text
    .replace(MARKDOWN_IMAGE, (_m, alt: string) => placeholder(alt))
    .replace(HTML_IMAGE, (tag) => placeholder(HTML_ALT.exec(tag)?.[1]))
    .replace(BARE_DATA_URI, '[image]');
}
