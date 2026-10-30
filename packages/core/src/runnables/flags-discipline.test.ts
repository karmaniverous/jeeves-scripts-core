/**
 * #14: every core runnable declares its flags, and reads them only through
 * `ctx.flags` (positionals through `ctx.args`). Core source outside the
 * argument plumbing never inspects raw arguments for flags.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type * as Jeeves from '@karmaniverous/jeeves';
import { describe, expect, it, vi } from 'vitest';

import { coreJobs, loadJob } from './registry.js';

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<typeof Jeeves>()),
  runScript: vi.fn(),
}));

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Argument plumbing, allowed to read raw arguments. */
const ALLOWED = new Set(
  [
    'lib/args.ts',
    'lib/dispatcher-flags.ts',
    'lib/spawn-worker.ts',
    'runnables/define-runnable.ts',
    'runnables/job-help.ts',
  ].map((p) => path.join(src, p)),
);

const RAW_READS = [
  /\b(?:args|argv)\.includes\(\s*['"`]-/,
  /\bprocess\.argv\b(?!\s*=)/,
  /\bparseRunnableArgs\(/,
  /from 'node:util'[^\n]*\bparseArgs\b|\bparseArgs\s*\(\s*\{/,
];

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'cli' ? [] : sourceFiles(p);
    return e.name.endsWith('.ts') && !/\.test(-helper)?\.ts$/.test(e.name)
      ? [p]
      : [];
  });

/** The code of a file without comments (doc examples may show raw reads). */
const code = (file: string): string =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('flag discipline (#14)', () => {
  it('every core runnable declares its flags', async () => {
    const undeclared: string[] = [];
    for (const e of coreJobs) {
      const job = await loadJob(e);
      if (!job.flags) undeclared.push(e.id);
    }
    expect(undeclared).toEqual([]);
  }, 120_000);

  it('no core source reads raw arguments for flags', () => {
    const offenders = sourceFiles(src)
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) =>
        RAW_READS.filter((re) => re.test(code(f))).map(
          (re) => `${path.relative(src, f)}: ${re.source}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
