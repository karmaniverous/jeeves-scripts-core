/**
 * `mirrorTree` and the publish record: an existing destination the mirror
 * didn't write is refused (live and dry) unless `adopt`; each live publish
 * is recorded, and a record for the same destination lets later runs sync
 * without `adopt`. A destination holding only `.meta/` (or nothing) is
 * not foreign. Against the real `rsync` in temp dirs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { snapshot, writeTree } from './library.test-helper.js';
import { listFiles, type MirrorOptions, mirrorTree } from './mirror.js';
import { readPublishRecord, writePublishRecord } from './publish-record.js';

const UPSTREAM = { 'a.md': '# A', 'b/c.md': '# C' };
const FOREIGN = {
  'notes/1.md': 'hand-authored',
  'notes/2.md': 'hand-authored',
  'notes/3.md': 'hand-authored',
};

describe('mirrorTree ownership of the destination', () => {
  let root: string;
  let opts: MirrorOptions;
  const lines: string[] = [];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-owner-'));
    writeTree(path.join(root, 'clone'), UPSTREAM);
    lines.length = 0;
    opts = {
      paths: {
        clone: path.join(root, 'clone'),
        source: path.join(root, 'clone'),
        stage: path.join(root, 'state', 'stage'),
        tmp: path.join(root, 'state', 'tmp'),
        incoming: path.join(root, 'state', 'incoming'),
        dest: path.join(root, 'content', 'library', 'docs'),
        record: path.join(root, 'state', 'published.json'),
      },
      live: true,
      head: 'abc1234',
      exclude: [],
      // The foreign tree outnumbers the stage: keep the shrink guard out of the way.
      minRatio: 0.1,
      log: (l) => lines.push(l),
    };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses a live run into an existing dest it did not write, writing nothing', () => {
    writeTree(opts.paths.dest, FOREIGN);
    const before = snapshot(opts.paths.dest);
    expect(() => mirrorTree(opts)).toThrow(
      `refusing to publish: ${opts.paths.dest} exists and was not written by this mirror; set adopt: true on the mirror to take it over`,
    );
    expect(snapshot(opts.paths.dest)).toEqual(before);
    expect(fs.existsSync(opts.paths.record)).toBe(false);
  });

  it('reports the refusal on a dry run, writing nothing', () => {
    writeTree(opts.paths.dest, FOREIGN);
    const before = snapshot(opts.paths.dest);
    expect(() => mirrorTree({ ...opts, live: false })).toThrow(
      `would refuse: ${opts.paths.dest} exists and was not written by this mirror (set adopt: true)`,
    );
    expect(snapshot(opts.paths.dest)).toEqual(before);
    expect(fs.existsSync(opts.paths.record)).toBe(false);
  });

  it('adopt: true takes the dest over and records the publish', () => {
    writeTree(opts.paths.dest, { ...FOREIGN, '.meta/meta.json': '{}' });
    const dry = mirrorTree({ ...opts, live: false, adopt: true });
    expect(dry).toMatchObject({ written: 2, created: false });
    expect(dry.deleted).toBeGreaterThanOrEqual(3);
    expect(lines).toContain(`WOULD ADOPT ${opts.paths.dest} (adopt: true)`);
    expect(fs.existsSync(opts.paths.record)).toBe(false);

    mirrorTree({ ...opts, adopt: true });
    expect(lines).toContain(`ADOPTING ${opts.paths.dest} (adopt: true)`);
    expect(listFiles(opts.paths.dest).sort()).toEqual([
      '.meta/meta.json',
      'a.md',
      'b/c.md',
    ]);
    expect(readPublishRecord(opts.paths.record)).toEqual({
      dest: opts.paths.dest,
      head: 'abc1234',
      publishedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as string,
    });
  });

  it('a recorded publish lets later runs sync without adopt', () => {
    writeTree(opts.paths.dest, FOREIGN);
    mirrorTree({ ...opts, adopt: true });
    fs.writeFileSync(path.join(opts.paths.source, 'a.md'), '# A2');
    const r = mirrorTree({ ...opts, head: 'def5678' });
    expect(r).toMatchObject({ written: 1, created: false });
    expect(readPublishRecord(opts.paths.record)?.head).toBe('def5678');
    expect(lines.filter((l) => l.startsWith('ADOPTING'))).toHaveLength(1);
  });

  it('records the first-run publish, so the next run needs no adopt', () => {
    mirrorTree(opts);
    expect(readPublishRecord(opts.paths.record)?.dest).toBe(opts.paths.dest);
    expect(mirrorTree(opts)).toMatchObject({ written: 0, created: false });
  });

  it.each([
    ['holds only .meta/', { '.meta/meta.json': '{}' }],
    ['is empty', {}],
  ])('publishes without adopt into a dest that %s', (_what, files) => {
    fs.mkdirSync(opts.paths.dest, { recursive: true });
    writeTree(opts.paths.dest, files);
    const r = mirrorTree(opts);
    expect(r).toMatchObject({ written: 2, created: false });
    expect(listFiles(opts.paths.dest, ['.meta']).sort()).toEqual([
      'a.md',
      'b/c.md',
    ]);
    expect(readPublishRecord(opts.paths.record)?.dest).toBe(opts.paths.dest);
  });

  it('a record for another dest (dest changed in config) does not count', () => {
    writePublishRecord(opts.paths.record, {
      dest: path.join(root, 'content', 'library', 'old'),
      head: 'abc1234',
      publishedAt: new Date().toISOString(),
    });
    writeTree(opts.paths.dest, FOREIGN);
    expect(() => mirrorTree(opts)).toThrow(/refusing to publish/);
    expect(listFiles(opts.paths.dest).sort()).toEqual(Object.keys(FOREIGN));
  });

  it('fails on a record that is not valid, touching nothing', () => {
    writeTree(opts.paths.dest, FOREIGN);
    writeTree(path.dirname(opts.paths.record), {
      [path.basename(opts.paths.record)]: '{"dest":1}',
    });
    expect(() => mirrorTree({ ...opts, adopt: true })).toThrow();
    expect(listFiles(opts.paths.dest).sort()).toEqual(Object.keys(FOREIGN));
  });
});
