#!/usr/bin/env tsx
/**
 * @module convert/docx-to-md
 *
 * Converts DOCX files to Markdown with YAML frontmatter.
 *
 * CLI entry point invoked with --paths. Scans the given directories for
 * .docx files, extracts HTML via mammoth, converts to Markdown, and
 * writes .docx.md alongside each source file. Skips files whose output
 * is already up to date. No dependency on project constants.
 */

import { readFileSync } from 'node:fs';

import { getArg, runScript } from '@karmaniverous/jeeves';
import mammoth from 'mammoth';

import {
  findFiles,
  needsConversion,
  writeMdFile,
} from './lib/convert-utils.js';

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const pathsRaw = getArg(argv, '--paths', '');
  if (!pathsRaw) throw new Error('--paths argument is required');

  const dirs = pathsRaw.split(',').map((p) => p.trim());
  const files = findFiles(dirs, '.docx');

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
      const buffer = readFileSync(filePath);
      const result = await mammoth.convertToHtml({ buffer });
      const markdown = htmlToMarkdown(result.value);

      writeMdFile(
        mdPath,
        {
          source: filePath,
          converted: new Date().toISOString(),
        },
        markdown,
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

runScript('convert/docx-to-md', main);
