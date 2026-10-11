/**
 * @module convert/docx-to-md
 *
 * `convertDocxToMd(dirs)`, a public utility (Decision 49): converts every
 * `.docx` file under the given directories to `<file>.docx.md` with YAML
 * frontmatter (HTML extracted with mammoth, then reduced to Markdown),
 * skipping files whose output is up to date. Reads and writes the
 * filesystem; logs one line per file. No dependency on instance config.
 */

import { convertFiles, type ConvertResult } from './lib/convert-files.js';

/** Convert simple HTML (from mammoth) to Markdown. */
function htmlToMarkdown(html: string): string {
  let md = html;

  // Headings
  for (let i = 6; i >= 1; i--) {
    const tag = `h${String(i)}`;
    const prefix = '#'.repeat(i);
    md = md.replace(
      new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gi'),
      `${prefix} $1\n\n`,
    );
  }

  // Bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // List items
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Remove list wrappers
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');

  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // Collapse excessive blank lines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Convert every `.docx` file under `dirs` to `<file>.docx.md`.
 *
 * @param dirs - Directories to scan recursively (missing ones are skipped).
 * @returns How many files were converted, skipped (up to date) and failed.
 *
 * @example
 * ```ts
 * import { convertDocxToMd } from '@karmaniverous/jeeves-scripts-core';
 *
 * const { converted, failed } = await convertDocxToMd(['/base/content/docs']);
 * ```
 */
export function convertDocxToMd(
  dirs: readonly string[],
): Promise<ConvertResult> {
  return convertFiles(dirs, '.docx', async (buffer) => {
    // Loaded on first use, so importing the root export stays cheap.
    const { default: mammoth } = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ buffer });
    return { content: htmlToMarkdown(value) };
  });
}
