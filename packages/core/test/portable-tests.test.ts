/**
 * Guards that keep the test suite runnable on an unprivileged Windows
 * account. Creating a directory symlink there needs Developer Mode or an
 * elevated shell (EPERM otherwise); a junction needs neither, behaves as a
 * symlink for `lstat`/`realpath`, and the type argument is ignored on other
 * platforms. CI's Windows runners are elevated, so they can't catch this.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const srcRoot = path.resolve(import.meta.dirname, '../src');

const testFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(full);
    return entry.name.endsWith('.test.ts') ? [full] : [];
  });

/** Every `symlinkSync(` call in `source` that doesn't pass `'junction'`. */
const bareSymlinkCalls = (source: string): string[] =>
  [...source.matchAll(/symlinkSync\(([^;]*?)\);/gs)]
    .map((m) => m[0])
    .filter((call) => !call.includes("'junction'"));

describe('portable tests', () => {
  it('flags a directory symlink without a type, and accepts a junction', () => {
    expect(bareSymlinkCalls('fs.symlinkSync(a, b);')).toHaveLength(1);
    expect(bareSymlinkCalls("fs.symlinkSync(a, b, 'junction');")).toEqual([]);
  });

  it('creates directory links in tests as junctions', () => {
    const offenders = testFiles(srcRoot).flatMap((file) =>
      bareSymlinkCalls(fs.readFileSync(file, 'utf8')).map(
        (call) => `${path.relative(srcRoot, file)}: ${call}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
