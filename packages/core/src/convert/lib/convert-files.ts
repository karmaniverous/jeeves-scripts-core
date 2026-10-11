/**
 * @module convert/lib/convert-files
 *
 * The conversion loop shared by `convertDocxToMd` and `convertPdfToMd`:
 * finds every file with an extension under the given directories, skips
 * those whose `<file>.md` is up to date, extracts the rest and writes
 * `<file>.md` with YAML frontmatter. Logs one line per file and a summary
 * (stdout); a file that fails to convert is logged and counted, never
 * thrown. Reads and writes the filesystem only.
 */

import { readFileSync } from 'node:fs';

import type { FrontmatterValue } from '../../lib/frontmatter.js';
import { findFiles, needsConversion, writeMdFile } from './convert-utils.js';

/** What one conversion run did. */
export interface ConvertResult {
  /** Files converted. */
  converted: number;
  /** Files skipped because their `.md` output was up to date. */
  skipped: number;
  /** Files that failed to convert (logged, not thrown). */
  failed: number;
}

/** One extracted document. */
export interface Extracted {
  /** Markdown body. */
  content: string;
  /** Frontmatter added after `source` and `converted`. */
  frontmatter?: Record<string, FrontmatterValue>;
}

/**
 * Convert every `ext` file under `dirs` to `<file>.md`.
 *
 * @param dirs - Directories to scan recursively (missing ones are skipped).
 * @param ext - File extension, e.g. `.pdf`.
 * @param extract - Turns a file's bytes into Markdown.
 * @param now - Clock for the `converted` timestamp (tests).
 */
export async function convertFiles(
  dirs: readonly string[],
  ext: string,
  extract: (data: Buffer) => Promise<Extracted>,
  now: () => Date = () => new Date(),
): Promise<ConvertResult> {
  const result: ConvertResult = { converted: 0, skipped: 0, failed: 0 };

  for (const filePath of findFiles([...dirs], ext)) {
    const mdPath = `${filePath}.md`;

    if (!needsConversion(filePath, mdPath)) {
      console.log(`SKIP ${filePath} (up to date)`);
      result.skipped++;
      continue;
    }

    try {
      console.log(`CONVERT ${filePath}`);
      const { content, frontmatter } = await extract(readFileSync(filePath));
      writeMdFile(
        mdPath,
        {
          source: filePath,
          converted: now().toISOString(),
          ...frontmatter,
        },
        content,
      );
      result.converted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAIL ${filePath}: ${msg}`);
      result.failed++;
    }
  }

  console.log(
    `Converted: ${String(result.converted)}, Skipped: ${String(result.skipped)}, Failed: ${String(result.failed)}`,
  );
  return result;
}
