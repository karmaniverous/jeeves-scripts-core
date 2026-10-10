/**
 * @module convert/lib/convert-utils
 *
 * Shared utilities for PDF/DOCX to Markdown conversion scripts.
 *
 * Consumed by convert/docx-to-md and convert/pdf-to-md. Provides
 * recursive file discovery, staleness checking, and Markdown output
 * with YAML frontmatter. No dependency on project constants.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Recursively find all files with the given extension under the provided directories. */
export function findFiles(dirs: string[], ext: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  }

  for (const d of dirs) {
    walk(d);
  }
  return results;
}

/** Return true if the source file needs conversion (md missing or older than source). */
export function needsConversion(sourcePath: string, mdPath: string): boolean {
  if (!fs.existsSync(mdPath)) return true;
  const srcStat = fs.statSync(sourcePath);
  const mdStat = fs.statSync(mdPath);
  return srcStat.mtimeMs > mdStat.mtimeMs;
}

/** Write a Markdown file with YAML frontmatter. */
export function writeMdFile(
  mdPath: string,
  frontmatter: Record<string, unknown>,
  content: string,
): void {
  const yamlLines = Object.entries(frontmatter).map(
    ([k, v]) => `${k}: ${typeof v === 'string' ? v : String(v)}`,
  );
  const out = `---\n${yamlLines.join('\n')}\n---\n\n${content}\n`;
  fs.writeFileSync(mdPath, out, 'utf8');
}
