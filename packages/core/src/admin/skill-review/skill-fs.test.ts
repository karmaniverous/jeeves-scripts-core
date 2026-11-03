/**
 * Tests for the live file system port (on a temp directory, including a
 * directory link; a link to a file through `fs` spies, since creating one
 * needs privileges on Windows) and `walkFiles`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { containedPath, nodeSkillFs, pathKey, walkFiles } from './skill-fs.js';
import { memorySkillFs } from './skill-fs.test-helper.js';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-fs-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('nodeSkillFs', () => {
  it('lists directories (following links) and files, and reads them', () => {
    fs.mkdirSync(path.join(root, 'real', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(root, 'real', 'SKILL.md'), 'text');
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');
    fs.symlinkSync(
      path.join(root, 'real'),
      path.join(root, 'linked'),
      'junction',
    );
    fs.symlinkSync(
      path.join(root, 'gone'),
      path.join(root, 'dangling'),
      'junction',
    );

    expect(nodeSkillFs.listDirs(root)).toEqual(['linked', 'real']);
    expect(nodeSkillFs.listFiles(root)).toEqual(['b.txt']);
    expect(nodeSkillFs.readText(path.join(root, 'linked', 'SKILL.md'))).toBe(
      'text',
    );
    expect(nodeSkillFs.mtimeMs(path.join(root, 'b.txt'))).toBeGreaterThan(0);
  });

  it('lists a link to a file as a file, and a link to neither as neither', () => {
    const link = (name: string) => ({
      name,
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => true,
    });
    const entries = [link('file-link'), link('fifo-link')];
    vi.spyOn(fs, 'readdirSync').mockReturnValue(entries as never);
    vi.spyOn(fs, 'statSync').mockImplementation(
      (p) =>
        ({
          isDirectory: () => false,
          isFile: () => String(p).endsWith('file-link'),
        }) as never,
    );
    expect(nodeSkillFs.listFiles(root)).toEqual(['file-link']);
    expect(nodeSkillFs.listDirs(root)).toEqual([]);
  });

  it('returns empty results for missing paths', () => {
    const missing = path.join(root, 'missing');
    expect(nodeSkillFs.listDirs(missing)).toEqual([]);
    expect(nodeSkillFs.listFiles(missing)).toEqual([]);
    expect(nodeSkillFs.readText(missing)).toBeUndefined();
    expect(nodeSkillFs.mtimeMs(missing)).toBeUndefined();
  });
});

describe('pathKey', () => {
  it.each([
    ['win32', true],
    ['linux', false],
    ['darwin', false],
  ] as const)('on %s, folds case: %s', (platform, folds) => {
    const a = pathKey('/skills/A', platform);
    expect(a === pathKey('/skills/a', platform)).toBe(folds);
    expect(a).toBe(pathKey('/skills/x/../A', platform));
  });
});

describe('containedPath', () => {
  const base = path.resolve('/run/p');

  it('resolves a relative path inside the root', () => {
    expect(containedPath(base, 'scripts/x.cjs')).toBe(
      path.join(base, 'scripts', 'x.cjs'),
    );
  });

  it.each([
    ['a parent segment', '../../outside.md'],
    ['a backslash parent segment', 'a\\..\\..\\x'],
    ['an absolute path', path.resolve('/etc/x')],
    ['a drive-relative path', 'C:x'],
    ['the root itself', '.'],
    ['an empty path', ''],
  ])('rejects %s', (_label, rel) => {
    expect(containedPath(base, rel)).toBeUndefined();
  });
});

describe('walkFiles', () => {
  it('walks to the depth limit, skipping node_modules and dot directories', () => {
    const skillFs = memorySkillFs({
      '/p/a.js': '',
      '/p/sub/b.js': '',
      '/p/sub/deeper/c.js': '',
      '/p/node_modules/x/d.js': '',
      '/p/.cache/e.js': '',
    });
    expect(walkFiles(skillFs, '/p')).toEqual([
      'a.js',
      'sub/b.js',
      'sub/deeper/c.js',
    ]);
    expect(walkFiles(skillFs, '/p', 1)).toEqual(['a.js', 'sub/b.js']);
  });
});
