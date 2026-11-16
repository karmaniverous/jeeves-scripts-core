/**
 * @module convert/pdf-to-md
 *
 * `convertPdfToMd(dirs)`, a public utility (Decision 49): converts every
 * `.pdf` file under the given directories to `<file>.pdf.md` with YAML
 * frontmatter (text extracted with pdf-parse, page count in `pages`),
 * skipping files whose output is up to date. A page with fewer than 20
 * non-whitespace characters (a scanned or image-only page) is listed in
 * `textlessPages` and in a stderr warning naming the file; the conversion
 * still succeeds (Decision 83.2). Reads and writes the filesystem; logs
 * one line per file. No dependency on instance config.
 */

import {
  convertFiles,
  type ConvertResult,
  type Extract,
} from './lib/convert-files.js';
import type { PdfPageText } from './lib/pdf-text.js';

/** Fewer non-whitespace characters than this make a page text-less. */
const MIN_PAGE_CHARS = 20;

/** The pages with fewer than {@link MIN_PAGE_CHARS} non-whitespace characters. */
const textlessPages = (pages: readonly PdfPageText[]): number[] =>
  pages
    .filter(({ text }) => text.replace(/\s/g, '').length < MIN_PAGE_CHARS)
    .map(({ num }) => num);

/**
 * Extract a `.pdf` file's text as Markdown, with its page count in `pages`
 * and any text-less pages in `textlessPages` (also warned on stderr).
 */
export const extractPdf: Extract = async (data, file) => {
  // Loaded on first use, so importing the root export stays cheap.
  const { extractPdfText } = await import('./lib/pdf-text.js');
  const { text, total, pages } = await extractPdfText(data);
  const textless = textlessPages(pages);
  if (textless.length > 0)
    console.warn(
      `WARN ${file}: text-less page${textless.length === 1 ? '' : 's'} ${textless.join(', ')} (fewer than ${String(MIN_PAGE_CHARS)} non-whitespace characters; scanned or image-only?)`,
    );
  return {
    content: text,
    frontmatter: {
      pages: total,
      textlessPages: textless.length > 0 ? textless : undefined,
    },
  };
};

/**
 * Convert every `.pdf` file under `dirs` to `<file>.pdf.md`.
 *
 * @param dirs - Directories to scan recursively (missing ones are skipped).
 * @returns How many files were converted, skipped (up to date) and failed.
 *
 * @example
 * ```ts
 * import { convertPdfToMd } from '@karmaniverous/jeeves-scripts-core';
 *
 * const { converted, failed } = await convertPdfToMd(['/base/content/docs']);
 * ```
 */
export function convertPdfToMd(
  dirs: readonly string[],
): Promise<ConvertResult> {
  return convertFiles(dirs, '.pdf', extractPdf);
}
