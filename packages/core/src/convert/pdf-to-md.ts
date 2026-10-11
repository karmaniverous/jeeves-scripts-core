/**
 * @module convert/pdf-to-md
 *
 * Converts PDF files to Markdown with YAML frontmatter.
 *
 * CLI entry point invoked with --paths. Scans the given directories for
 * .pdf files, extracts text via pdf-parse, and writes .pdf.md alongside
 * each source file. Skips files whose output is already up to date.
 * No dependency on project constants.
 */

import { readFileSync } from 'node:fs';

import { getArg } from '@karmaniverous/jeeves';

import { defineJob } from '../jobs/define-job.js';
import {
  findFiles,
  needsConversion,
  writeMdFile,
} from './lib/convert-utils.js';
import { extractPdfText } from './lib/pdf-text.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const pathsRaw = getArg(argv, '--paths', '');
  if (!pathsRaw) throw new Error('--paths argument is required');

  const dirs = pathsRaw.split(',').map((p) => p.trim());
  const files = findFiles(dirs, '.pdf');

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const filePath of files) {
    const mdPath = `${filePath}.md`;

    if (!needsConversion(filePath, mdPath)) {
      console.log(`SKIP ${filePath} (up to date)`);
      skipped++;
      continue;
    }

    try {
      console.log(`CONVERT ${filePath}`);
      const textResult = await extractPdfText(readFileSync(filePath));

      writeMdFile(
        mdPath,
        {
          source: filePath,
          converted: new Date().toISOString(),
          pages: textResult.total,
        },
        textResult.text,
      );
      converted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAIL ${filePath}: ${msg}`);
      failed++;
    }
  }

  console.log(
    `Converted: ${String(converted)}, Skipped: ${String(skipped)}, Failed: ${String(failed)}`,
  );
}

export default defineJob({
  id: 'convert-pdf-to-md',
  domain: 'convert',
  name: 'convert/pdf-to-md',
  run: () => main(),
});
