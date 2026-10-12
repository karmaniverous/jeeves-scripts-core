/**
 * @module convert/lib/convert-files
 *
 * The conversion code shared by `convertDocxToMd` / `convertPdfToMd` and
 * their thin runnables: {@link convertFiles} finds every file with an
 * extension under the given directories, skips those whose `<file>.md` is
 * up to date, extracts the rest and writes `<file>.md` with YAML
 * frontmatter (logging one line per file and a summary; a file that fails
 * is logged and counted, never thrown). {@link convertFile} converts one
 * file to a given output path. Reads and writes the filesystem only.
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

/** Turns a file's bytes into Markdown. */
export type Extract = (data: Buffer) => Promise<Extracted>;

/**
 * Convert one file to Markdown at `output`, with `source`, `converted` and
 * the extractor's frontmatter. Overwrites `output`.
 *
 * @param input - The file to convert.
 * @param output - The Markdown file to write.
 * @param extract - Turns the file's bytes into Markdown.
 * @param now - Clock for the `converted` timestamp (tests).
 * @throws When the input can't be read or extracted, or the output written.
 */
export async function convertFile(
  input: string,
  output: string,
  extract: Extract,
  now: () => Date = () => new Date(),
): Promise<void> {
  const { content, frontmatter } = await extract(readFileSync(input));
  writeMdFile(
    output,
    { source: input, converted: now().toISOString(), ...frontmatter },
    content,
  );
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
  extract: Extract,
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
      await convertFile(filePath, mdPath, extract, now);
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

/**
 * The body of a thin convert runnable: `run <id> <in> <out>` converts one
 * file.
 *
 * @param id - The runnable id, for the usage message.
 * @param args - The runnable's arguments.
 * @param extract - Turns the file's bytes into Markdown.
 * @throws When the arguments are not exactly `<in> <out>`, or the
 *   conversion fails.
 */
export async function convertFileArgs(
  id: string,
  args: readonly string[],
  extract: Extract,
): Promise<void> {
  const [input, output] = args;
  if (args.length !== 2 || !input || !output)
    throw new Error(`Usage: jeeves-scripts run ${id} <in> <out>`);
  await convertFile(input, output, extract);
  console.log(`CONVERT ${input} -> ${output}`);
}
