import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_AGE_MS, sweepDir, sweepDirs } from './sweep-tmp.js';

let root: string;
const now = Date.now();

/** Write `rel` under `root` with an mtime `ageMs` before `now`. */
const touch = (rel: string, ageMs: number): string => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  const t = new Date(now - ageMs);
  fs.utimesSync(file, t, t);
  return file;
};

describe('sweep-tmp', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-sweep-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes old .tmp files recursively and keeps the rest', () => {
    const oldTop = touch('a.json.tmp', MAX_AGE_MS + 60_000);
    const oldDot = touch('.b.tmp', MAX_AGE_MS + 60_000);
    const oldDeep = touch('x/y/c.tmp', MAX_AGE_MS + 60_000);
    const fresh = touch('d.tmp', 60_000);
    const other = touch('e.json', MAX_AGE_MS + 60_000);

    expect(sweepDir(root, now)).toBe(3);
    for (const f of [oldTop, oldDot, oldDeep])
      expect(fs.existsSync(f)).toBe(false);
    for (const f of [fresh, other]) expect(fs.existsSync(f)).toBe(true);
  });

  it('skips node_modules and .git', () => {
    const nm = touch('node_modules/p/a.tmp', MAX_AGE_MS + 60_000);
    const git = touch('.git/b.tmp', MAX_AGE_MS + 60_000);
    expect(sweepDir(root, now)).toBe(0);
    expect(fs.existsSync(nm)).toBe(true);
    expect(fs.existsSync(git)).toBe(true);
  });

  it('returns 0 for an unreadable directory', () => {
    expect(sweepDir(path.join(root, 'missing'), now)).toBe(0);
  });

  it('ignores a file that vanishes before lstat, and rethrows other errors', () => {
    touch('a.tmp', MAX_AGE_MS + 60_000);
    const enoent = Object.assign(new Error('gone'), { code: 'ENOENT' });
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw enoent;
    });
    expect(sweepDir(root, now)).toBe(0);

    const eperm = Object.assign(new Error('denied'), { code: 'EPERM' });
    spy.mockImplementation(() => {
      throw eperm;
    });
    expect(() => sweepDir(root, now)).toThrow('denied');
  });

  it('sweeps every listed directory once with the same rules, skipping missing ones', () => {
    touch('one/a.tmp', MAX_AGE_MS + 60_000);
    touch('two/deep/b.tmp', MAX_AGE_MS + 60_000);
    touch('two/c.tmp', 60_000);
    const one = path.join(root, 'one');
    const two = path.join(root, 'two');
    const lines: string[] = [];

    const total = sweepDirs(
      [one, two, `${two}${path.sep}`, path.join(root, 'missing')],
      now,
      (l) => lines.push(l),
    );

    expect(total).toBe(2);
    expect(lines).toEqual([
      `Removed 1 orphaned .tmp file(s) from ${one}`,
      `Removed 1 orphaned .tmp file(s) from ${two}`,
    ]);
  });

  it('logs once when nothing was removed', () => {
    const log = vi.fn();
    expect(sweepDirs([root], now, log)).toBe(0);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'No orphaned .tmp files found.',
    );
  });
});
