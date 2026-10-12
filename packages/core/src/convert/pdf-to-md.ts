/**
 * @module convert/pdf-to-md
 *
 * `convertPdfToMd(dirs)`, a public utility (Decision 49): converts every
 * `.pdf` file under the given directories to `<file>.pdf.md` with YAML
 * frontmatter (text extracted with pdf-parse, page count in `pages`),
 * skipping files whose output is up to date. Reads and writes the
 * filesystem; logs one line per file. No dependency on instance config.
 */

import {
  convertFiles,
  type ConvertResult,
  type Extract,
} from './lib/convert-files.js';

/** Extract a `.pdf` file's text as Markdown, with its page count in `pages`. */
export const extractPdf: Extract = async (data) => {
  // Loaded on first use, so importing the root export stays cheap.
  const { extractPdfText } = await import('./lib/pdf-text.js');
  const { text, total } = await extractPdfText(data);
  return { content: text, frontmatter: { pages: total } };
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
