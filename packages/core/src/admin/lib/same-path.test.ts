import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isSamePath } from './same-path.js';

let root: string;
let live: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'same-path-'));
  live = path.join(root, 'state', 'token-metrics');
  fs.mkdirSync(live, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A directory link (a junction on Windows, which needs no privilege). */
function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, 'junction');
}

describe('isSamePath', () => {
  it('matches the same directory written differently', () => {
    expect(isSamePath(live, live)).toBe(true);
    expect(isSamePath(`${live}${path.sep}`, live)).toBe(true);
    expect(isSamePath(path.join(live, '..', 'token-metrics'), live)).toBe(true);
  });

  it('matches an empty live store reached through a symlink', () => {
    const alias = path.join(root, 'alias');
    linkDir(live, alias);
    expect(isSamePath(alias, live)).toBe(true);
  });

  it('matches a not-yet-existing path under a symlinked parent', () => {
    const parentAlias = path.join(root, 'state-alias');
    linkDir(path.join(root, 'state'), parentAlias);
    const liveChild = path.join(live, 'scratch');
    expect(isSamePath(path.join(parentAlias, 'token-metrics'), live)).toBe(
      true,
    );
    expect(
      isSamePath(path.join(parentAlias, 'token-metrics', 'scratch'), liveChild),
    ).toBe(true);
  });

  it('does not match an isolated scratch directory', () => {
    const scratch = path.join(root, 'scratch');
    fs.mkdirSync(scratch);
    expect(isSamePath(scratch, live)).toBe(false);
    expect(isSamePath(path.join(root, 'missing'), live)).toBe(false);
    // A directory inside the live store is not the live store.
    expect(isSamePath(path.join(live, '2026'), live)).toBe(false);
  });
});

describe('isSamePath edge cases', () => {
  it('compares paths under a missing root as they are', () => {
    const root = path.parse(process.cwd()).root;
    const missing = path.join(root, 'no-such-root-dir-xyz', 'a');
    expect(isSamePath(missing, path.join(missing, '.'))).toBe(true);
  });

  it('is case-sensitive off Windows', () => {
    const saved = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'same-path-'));
      expect(isSamePath(dir, dir)).toBe(true);
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      Object.defineProperty(process, 'platform', { value: saved });
    }
  });
});

describe('isSamePath on Windows', () => {
  it('ignores case', () => {
    const saved = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'same-path-win-'));
      expect(isSamePath(path.join(dir, 'Sub'), path.join(dir, 'sub'))).toBe(
        true,
      );
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      Object.defineProperty(process, 'platform', { value: saved });
    }
  });
});
