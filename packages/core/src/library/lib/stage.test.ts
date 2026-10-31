/**
 * The staging step on its own: `listFiles` (the walk the mirror's counts
 * use) and `stageTree` with a stand-in rsync that copies the tree, so the
 * arguments it is given and the link rewrite are checked without the real
 * rsync (`mirror.test.ts` runs it end to end).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeTree } from './library.test-helper.js';
import type { RsyncArgsOptions } from './rsync.js';
import { listFiles, stageTree } from './stage.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-stage-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('is empty for a missing root', () => {
    expect(listFiles(path.join(root, 'absent'))).toEqual([]);
  });

  it('lists every file, dot files included, relative and /-separated', () => {
    writeTree(root, {
      'a.md': 'a',
      '.hidden': 'h',
      'x/y/z.md': 'z',
      'x/.meta/meta.json': '{}',
    });
    expect(listFiles(root).sort()).toEqual([
      '.hidden',
      'a.md',
      'x/.meta/meta.json',
      'x/y/z.md',
    ]);
  });

  it('skips directories named in skip at any depth, but not files of that name', () => {
    writeTree(root, {
      '.meta/top.json': '{}',
      'x/.meta/deep.json': '{}',
      'x/keep.md': 'k',
      'y/.meta': 'a file, not a directory',
    });
    expect(listFiles(root, ['.meta']).sort()).toEqual(['x/keep.md', 'y/.meta']);
  });

  // A junction where symlinks need privileges (test/portable-tests); a
  // directory symlink elsewhere. Neither is a file, and neither is walked.
  it('neither lists nor follows a link', () => {
    writeTree(root, { 'tree/a.md': 'a', 'outside/secret.md': 's' });
    fs.symlinkSync(
      path.join(root, 'outside'),
      path.join(root, 'tree', 'link'),
      'junction',
    );
    expect(listFiles(path.join(root, 'tree'))).toEqual(['a.md']);
  });
});

describe('stageTree', () => {
  const calls: RsyncArgsOptions[] = [];
  const lines: string[] = [];
  /** Stands in for rsync: records its options and copies source into dest. */
  const rsync = (opts: RsyncArgsOptions): string => {
    calls.push(opts);
    fs.cpSync(opts.source, opts.dest, { recursive: true });
    return '';
  };
  const dirs = () => ({
    source: path.join(root, 'source'),
    stage: path.join(root, 'state', 'stage'),
  });
  beforeEach(() => {
    calls.length = 0;
    lines.length = 0;
  });

  it('copies the source into a new stage, leaving .git/ and the excludes out, deleting excluded files', () => {
    writeTree(dirs().source, { 'a.md': 'a', 'b/c.md': 'c' });
    const r = stageTree({ ...dirs(), exclude: ['/.system/'] }, rsync, (l) =>
      lines.push(l),
    );
    expect(calls).toEqual([
      {
        source: dirs().source,
        dest: dirs().stage,
        exclude: ['/.system/', '.git/'],
        deleteExcluded: true,
        dryRun: false,
      },
    ]);
    expect(r).toEqual({ staged: ['a.md', 'b/c.md'], links: 0 });
    expect(lines).toEqual([]);
  });

  it('throws on an empty stage, naming the source', () => {
    fs.mkdirSync(dirs().source, { recursive: true });
    expect(() =>
      stageTree({ ...dirs(), exclude: [] }, rsync, (l) => lines.push(l)),
    ).toThrow(`no files to mirror in ${dirs().source}`);
  });

  it("rewrites site links in UTF-8 text files only, keeping each rewritten file's mtime", () => {
    const latin1 = Buffer.from('caf\xe9 [x](/skill/b)', 'latin1');
    const binary = Buffer.from([0, 47, 115, 107, 105, 108, 108, 47, 98]);
    writeTree(dirs().source, {
      'a/SKILL.md': 'See [b](/skill/b) and [nope](/skill/nope).',
      'b/SKILL.md': '# B',
      'c/latin1.md': latin1,
      'c/binary.bin': binary,
    });
    const at = (rel: string) => path.join(dirs().stage, rel);
    const old = new Date('2020-01-02T03:04:05Z');
    const rsyncKeepingTimes = (opts: RsyncArgsOptions): string => {
      const out = rsync(opts);
      for (const rel of listFiles(opts.dest))
        fs.utimesSync(path.join(opts.dest, rel), old, old);
      return out;
    };
    const r = stageTree(
      {
        ...dirs(),
        exclude: [],
        siteLinks: { pattern: '/skill/{name}', target: '{dir}/SKILL.md' },
      },
      rsyncKeepingTimes,
      (l) => lines.push(l),
    );
    expect(r.links).toBe(1);
    expect(fs.readFileSync(at('a/SKILL.md'), 'utf8')).toBe(
      'See [b](../b/SKILL.md) and [nope](/skill/nope).',
    );
    expect(fs.statSync(at('a/SKILL.md')).mtime).toEqual(old);
    expect(fs.readFileSync(at('c/latin1.md'))).toEqual(latin1);
    expect(fs.readFileSync(at('c/binary.bin'))).toEqual(binary);
    expect(lines).toEqual(['LINKS a/SKILL.md: 1 rewritten']);
  });
});
