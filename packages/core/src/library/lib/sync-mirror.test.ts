/**
 * `syncMirrors` end to end against the real `git` and `rsync`, with local
 * repos standing in for GitHub.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { libraryMirrorSchema } from '../../config/library-schema.js';
import { makeRepo } from './library.test-helper.js';
import { listFiles } from './mirror.js';
import { readPublishRecord } from './publish-record.js';
import {
  githubCloneUrl,
  type LibraryDeps,
  type LibrarySettings,
  mirrorDirs,
  reportLine,
  syncMirrors,
} from './sync-mirror.js';

/** A token-shaped string, assembled so no scanner sees a literal one. */
const TOKEN = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');

/** The one element of `xs`. */
const only = <T>(xs: readonly T[]): T => {
  const [x] = xs;
  if (xs.length !== 1 || x === undefined) throw new Error('expected one');
  return x;
};

describe('syncMirrors', () => {
  let root: string;
  let settings: LibrarySettings;
  let deps: LibraryDeps;
  const urls = new Map<string, string>();
  const lines: string[] = [];
  let logged: string[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'library-sync-'));
    settings = {
      live: true,
      stateDir: path.join(root, 'state'),
      contentDir: path.join(root, 'content'),
    };
    urls.clear();
    urls.set(
      'acme/docs',
      makeRepo(path.join(root, 'up', 'docs'), {
        'guides/a.md': `# A\n\ntoken: ${TOKEN}\n`,
        'guides/b/README.md': '# B',
        'other.md': 'not mirrored',
      }),
    );
    urls.set(
      'acme/empty',
      makeRepo(path.join(root, 'up', 'empty'), {
        'skills/.system/tool.md': 'excluded',
      }),
    );
    lines.length = 0;
    deps = {
      run,
      cloneUrl: (repo) => urls.get(repo) ?? '',
      log: (l) => lines.push(l),
    };
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => {
      logged.push(l);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const docs = libraryMirrorSchema.parse({
    id: 'docs',
    repo: 'acme/docs',
    subdir: 'guides',
    dest: 'library/docs',
  });
  const empty = libraryMirrorSchema.parse({
    id: 'empty',
    repo: 'acme/empty',
    subdir: 'skills',
    dest: 'library/empty',
    exclude: ['.system/'],
  });
  const result = () =>
    JSON.parse(
      (logged.find((l) => l.startsWith('JR_RESULT:')) ?? '').slice(10),
    ) as { meta: string; mirrors: { id: string }[]; failed: object };

  it('mirrors a repo subdirectory under the content dir, byte-exact (no redaction)', () => {
    const r = only(syncMirrors([docs], settings, deps));
    const dest = path.join(root, 'content', 'library', 'docs');
    expect(listFiles(dest).sort()).toEqual(['a.md', 'b/README.md']);
    expect(fs.readFileSync(path.join(dest, 'a.md'), 'utf8')).toBe(
      `# A\n\ntoken: ${TOKEN}\n`,
    );
    expect(r).toMatchObject({
      id: 'docs',
      files: 2,
      links: 0,
      write: 2,
      created: true,
    });
    expect(lines).toContain(reportLine(r, true));
    expect(result()).toEqual({
      meta: reportLine(r, true),
      mirrors: [r],
      failed: {},
    });
  });

  it('finishes the other mirrors when one fails its guard, then fails the run', () => {
    expect(() => syncMirrors([empty, docs], settings, deps)).toThrow(
      /library-sync-mirrors: 1 of 2 mirrors failed: empty \(no files to mirror/,
    );
    expect(
      fs.existsSync(path.join(root, 'content', 'library', 'docs', 'a.md')),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, 'content', 'library', 'empty'))).toBe(
      false,
    );
    expect(lines.some((l) => l.startsWith('empty: FAILED: no files'))).toBe(
      true,
    );
    const jr = result();
    expect(jr.mirrors.map((m) => m.id)).toEqual(['docs']);
    expect(Object.keys(jr.failed)).toEqual(['empty']);
    expect(jr.meta).toMatch(/^docs: live .*; empty: FAILED$/);
  });

  it('dry run updates only the clone and stage, never the content tree', () => {
    const r = only(syncMirrors([docs], { ...settings, live: false }, deps));
    const dirs = mirrorDirs(docs, settings);
    expect(fs.existsSync(dirs.dest)).toBe(false);
    expect(fs.existsSync(dirs.incoming)).toBe(false);
    expect(fs.existsSync(dirs.tmp)).toBe(false);
    expect(listFiles(dirs.stage)).toHaveLength(2);
    expect(r).toMatchObject({ write: 2, created: true });
    expect(lines[0]).toBe('DRY RUN: pass --live to write');
    expect(lines).toContain(`docs: WOULD CREATE ${dirs.dest} (single rename)`);
  });

  it('refuses a mirror into a dest it did not write, runs the rest, and adopts it with adopt: true', () => {
    const dirs = mirrorDirs(docs, settings);
    fs.mkdirSync(dirs.dest, { recursive: true });
    fs.writeFileSync(path.join(dirs.dest, 'mine.md'), 'hand-authored');
    const other = libraryMirrorSchema.parse({
      ...docs,
      id: 'other',
      dest: 'library/other',
    });
    expect(() => syncMirrors([docs, other], settings, deps)).toThrow(
      /1 of 2 mirrors failed: docs \(refusing to publish: .* set adopt: true/,
    );
    expect(listFiles(dirs.dest)).toEqual(['mine.md']);
    expect(listFiles(mirrorDirs(other, settings).dest)).toHaveLength(2);

    const r = only(syncMirrors([{ ...docs, adopt: true }], settings, deps));
    expect(listFiles(dirs.dest).sort()).toEqual(['a.md', 'b/README.md']);
    expect(readPublishRecord(dirs.record)).toMatchObject({
      dest: dirs.dest,
      head: r.head,
    });
  });

  it('a re-run with no upstream change writes and touches nothing', () => {
    syncMirrors([docs], settings, deps);
    const r = only(syncMirrors([docs], settings, deps));
    expect(r).toMatchObject({ write: 0, touch: 0, delete: 0, created: false });
  });
});

describe('mirrorDirs', () => {
  it('keeps clone, staging and the publish record under {stateDir}/library/<id>, dest under the content dir', () => {
    const dirs = mirrorDirs(
      { id: 'docs', subdir: 'guides', dest: 'library/docs' },
      {
        stateDir: path.resolve('/base/state'),
        contentDir: path.resolve('/base/content'),
      },
    );
    const state = path.resolve('/base/state/library/docs');
    expect(dirs).toEqual({
      clone: path.join(state, 'clone'),
      source: path.join(state, 'clone', 'guides'),
      stage: path.join(state, 'stage'),
      tmp: path.join(state, 'tmp'),
      incoming: path.join(state, 'incoming'),
      dest: path.resolve('/base/content/library/docs'),
      record: path.join(state, 'published.json'),
    });
  });
});

describe('githubCloneUrl', () => {
  it('is the anonymous HTTPS URL', () => {
    expect(githubCloneUrl('acme/docs')).toBe(
      'https://github.com/acme/docs.git',
    );
  });
});
