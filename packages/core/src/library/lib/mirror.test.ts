/**
 * `mirrorTree` against the real `rsync` in temp dirs (on Windows, the
 * Cygwin build `choco install rsync` installs; paths go through
 * `rsyncPath`).
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mirrorFixture, snapshot, writeTree } from './library.test-helper.js';
import { type MirrorOptions, mirrorTree } from './mirror.js';
import { listFiles } from './stage.js';

const UPSTREAM = {
  'author-a/author.md': '# Author A',
  'author-a/writing-style/SKILL.md': '# Writing style',
  'author-a/reporting/SKILL.md':
    'See [style](/skill/writing-style) and [ref](./references/a.md).',
  'author-a/reporting/references/a.md': 'ref',
  'author-b/cold-email/SKILL.md': '# Cold email',
  '.system/submit/SKILL.md': '# tooling',
};
const MIRRORED = Object.keys(UPSTREAM)
  .filter((f) => !f.startsWith('.system'))
  .sort();

describe('mirrorTree', () => {
  let root: string;
  let opts: MirrorOptions;
  let lines: string[];

  beforeEach(() => {
    ({ root, opts, lines } = mirrorFixture('library-mirror-', UPSTREAM, {
      subdir: 'sub',
      dest: 'skills',
      exclude: ['/.system/'],
      siteLinks: { pattern: '/skill/{name}', target: '{dir}/SKILL.md' },
    }));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('dry run stages but never creates the destination, incoming or tmp', () => {
    const r = mirrorTree({ ...opts, live: false });
    expect(fs.existsSync(opts.paths.dest)).toBe(false);
    expect(fs.existsSync(opts.paths.incoming)).toBe(false);
    expect(fs.existsSync(opts.paths.tmp)).toBe(false);
    expect(listFiles(opts.paths.stage).sort()).toEqual(MIRRORED);
    expect(r).toMatchObject({ created: true, files: 5, links: 1, written: 5 });
    expect(lines).toContain(`WOULD CREATE ${opts.paths.dest} (single rename)`);
  });

  it('first-run dry run ignores a stale incoming a failed live run left', () => {
    writeTree(opts.paths.incoming, {
      'author-a/author.md': UPSTREAM['author-a/author.md'],
      'stale.md': 'left over',
    });
    const r = mirrorTree({ ...opts, live: false });
    expect(r).toMatchObject({ created: true, files: 5, written: 5 });
    expect(fs.existsSync(opts.paths.dest)).toBe(false);
  });

  it('first live run clears a stale incoming before assembling', () => {
    writeTree(opts.paths.incoming, { 'stale.md': 'left over' });
    mirrorTree(opts);
    expect(listFiles(opts.paths.dest).sort()).toEqual(MIRRORED);
  });

  it('an exclude added after a run removes its files from stage and dest, keeping .meta/', () => {
    mirrorTree(opts);
    writeTree(opts.paths.dest, { '.meta/meta.json': '{}' });
    const r = mirrorTree({ ...opts, exclude: ['/.system/', '/author-b/'] });
    expect(r.deleted).toBeGreaterThan(0);
    for (const tree of [opts.paths.stage, opts.paths.dest])
      expect(listFiles(tree).some((f) => f.startsWith('author-b/'))).toBe(
        false,
      );
    expect(fs.existsSync(path.join(opts.paths.dest, '.meta/meta.json'))).toBe(
      true,
    );
  });

  // Directory links as junctions, so an unprivileged Windows account can
  // create them (test/portable-tests). Windows makes every junction
  // absolute, so there the in-tree link is dropped too; elsewhere these are
  // plain symlinks and the relative ones stay relative.
  it('copies only symlinks that stay inside the tree', () => {
    const outside = path.join(root, 'outside');
    writeTree(outside, { 'secret.md': 'host secret' });
    const at = (rel: string) => path.join(opts.paths.source, rel);
    fs.symlinkSync(outside, at('abs'), 'junction');
    fs.symlinkSync('../../outside', at('up'), 'junction');
    fs.symlinkSync('author-a', at('in'), 'junction');
    mirrorTree(opts);
    for (const tree of [opts.paths.stage, opts.paths.dest]) {
      const names = fs.readdirSync(tree);
      expect(names).not.toContain('abs');
      expect(names).not.toContain('up');
      expect(names.includes('in')).toBe(process.platform !== 'win32');
      expect(listFiles(tree).some((f) => f.includes('secret'))).toBe(false);
    }
  });

  it('refuses a source that resolves outside the clone', () => {
    const outside = path.join(root, 'outside');
    writeTree(outside, { 'host.md': 'host file' });
    fs.rmSync(opts.paths.source, { recursive: true });
    fs.symlinkSync(outside, opts.paths.source, 'junction');
    expect(() => mirrorTree(opts)).toThrow(/resolves outside the clone/);
    expect(fs.existsSync(opts.paths.stage)).toBe(false);
    expect(fs.existsSync(opts.paths.dest)).toBe(false);
  });

  it('dry run leaves an existing destination untouched', () => {
    mirrorTree(opts);
    const before = snapshot(opts.paths.dest);
    fs.writeFileSync(
      path.join(opts.paths.source, 'author-b/cold-email/SKILL.md'),
      '# changed',
    );
    fs.rmSync(path.join(opts.paths.source, 'author-a/author.md'));
    fs.rmSync(opts.paths.tmp, { recursive: true, force: true });
    const r = mirrorTree({ ...opts, live: false });
    expect(snapshot(opts.paths.dest)).toEqual(before);
    expect(fs.existsSync(opts.paths.tmp)).toBe(false);
    expect(r).toMatchObject({ written: 1, deleted: 1, created: false });
  });

  it('first live run publishes by one rename, rewrites links, skips excludes', () => {
    const r = mirrorTree(opts);
    expect(r).toMatchObject({ created: true, files: 5, links: 1, written: 5 });
    expect(fs.existsSync(opts.paths.incoming)).toBe(false);
    expect(listFiles(opts.paths.dest).sort()).toEqual(MIRRORED);
    expect(
      fs.readFileSync(
        path.join(opts.paths.dest, 'author-a/reporting/SKILL.md'),
        'utf8',
      ),
    ).toBe(
      'See [style](../writing-style/SKILL.md) and [ref](./references/a.md).',
    );
    expect(lines).toContain(`CREATED ${opts.paths.dest} (single rename)`);
    expect(lines).toContain('LINKS author-a/reporting/SKILL.md: 1 rewritten');
  });

  it('copies files unchanged when no siteLinks is configured', () => {
    const r = mirrorTree({ ...opts, siteLinks: undefined });
    expect(r.links).toBe(0);
    expect(
      fs.readFileSync(
        path.join(opts.paths.dest, 'author-a/reporting/SKILL.md'),
        'utf8',
      ),
    ).toBe(UPSTREAM['author-a/reporting/SKILL.md']);
  });

  it('leaves binary and non-UTF-8 files byte-exact even when they hold a link', () => {
    const binary = Buffer.concat([
      Buffer.from('[x](/skill/writing-style)'),
      Buffer.from([0, 1, 2]),
    ]);
    const latin1 = Buffer.from('caf\xe9 [x](/skill/writing-style)', 'latin1');
    writeTree(opts.paths.source, { 'bin/a.dat': binary, 'bin/b.md': latin1 });
    mirrorTree(opts);
    expect(fs.readFileSync(path.join(opts.paths.dest, 'bin/a.dat'))).toEqual(
      binary,
    );
    expect(fs.readFileSync(path.join(opts.paths.dest, 'bin/b.md'))).toEqual(
      latin1,
    );
  });

  it('an unchanged second run changes no content or mtime', () => {
    mirrorTree(opts);
    const before = snapshot(opts.paths.dest);
    const r = mirrorTree(opts);
    expect(snapshot(opts.paths.dest)).toEqual(before);
    expect(r).toMatchObject({ written: 0, touched: 0, deleted: 0, links: 1 });
  });

  it('propagates upstream changes and deletions, preserving .meta/', () => {
    mirrorTree(opts);
    writeTree(opts.paths.dest, {
      '.meta/meta.json': '{"_id":"x"}',
      'author-a/.meta/meta.json': '{"_id":"y"}',
    });
    fs.writeFileSync(
      path.join(opts.paths.source, 'author-b/cold-email/SKILL.md'),
      '# changed',
    );
    fs.rmSync(path.join(opts.paths.source, 'author-a/author.md'));
    const r = mirrorTree(opts);
    expect(r).toMatchObject({ written: 1, deleted: 1, created: false });
    const dest = (rel: string) => path.join(opts.paths.dest, rel);
    expect(fs.readFileSync(dest('author-b/cold-email/SKILL.md'), 'utf8')).toBe(
      '# changed',
    );
    expect(fs.existsSync(dest('author-a/author.md'))).toBe(false);
    expect(fs.readFileSync(dest('.meta/meta.json'), 'utf8')).toBe(
      '{"_id":"x"}',
    );
    expect(fs.existsSync(dest('author-a/.meta/meta.json'))).toBe(true);
  });

  it('never mirrors the source .git directory', () => {
    writeTree(opts.paths.source, { '.git/HEAD': 'ref: refs/heads/main' });
    mirrorTree(opts);
    expect(fs.existsSync(path.join(opts.paths.dest, '.git'))).toBe(false);
  });

  it('rejects a missing source', () => {
    fs.rmSync(opts.paths.source, { recursive: true });
    expect(() => mirrorTree(opts)).toThrow(/source not found/);
  });

  it('rejects an empty source, before touching the destination', () => {
    mirrorTree(opts);
    const before = snapshot(opts.paths.dest);
    fs.rmSync(opts.paths.source, { recursive: true });
    writeTree(opts.paths.source, { '.system/only.md': 'excluded' });
    expect(() => mirrorTree(opts)).toThrow(/no files to mirror/);
    expect(snapshot(opts.paths.dest)).toEqual(before);
  });

  it('rejects a shrink below minRatio, ignoring .meta in the count', () => {
    mirrorTree(opts);
    writeTree(opts.paths.dest, {
      '.meta/a.json': '{}',
      '.meta/b.json': '{}',
      '.meta/c.json': '{}',
    });
    const before = snapshot(opts.paths.dest);
    fs.rmSync(path.join(opts.paths.source, 'author-a'), { recursive: true });
    // 1 staged file vs 5 mirrored: below half.
    expect(() => mirrorTree(opts)).toThrow(/refusing to shrink/);
    expect(snapshot(opts.paths.dest)).toEqual(before);
    // 1 of 5 passes at 0.2.
    expect(mirrorTree({ ...opts, minRatio: 0.2 }).deleted).toBeGreaterThan(0);
  });

  it('rejects state and destination on different filesystems', () => {
    expect(() =>
      mirrorTree({
        ...opts,
        deviceOf: (p) => (p.startsWith(opts.paths.dest) ? 2 : 1),
      }),
    ).toThrow(/different filesystems/);
    expect(fs.existsSync(opts.paths.dest)).toBe(false);
    expect(fs.existsSync(opts.paths.stage)).toBe(false);
  });
});
