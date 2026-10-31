/**
 * `library-sync-mirrors` as a registered runnable: its manifest ships off
 * (daily 04:10 UTC, overlap skip, 600 s); it skips with no mirror
 * configured, and its prerequisite reports a missing `git` or `rsync`;
 * configured, it reads `library.mirrors` and the instance's state and
 * content dirs, dry unless `--live`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run } from '@karmaniverous/jeeves';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { libraryMirrorSchema } from '../config/library-schema.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import { readCoreManifests } from '../runnables/manifest.js';
import { coreJobs, loadJob } from '../runnables/registry.js';
import { makeRepo } from './lib/library.test-helper.js';
import { listFiles } from './lib/mirror.js';
import {
  libraryDeps,
  libraryPrerequisite,
  NO_MIRRORS,
  onPath,
  runMirrors,
} from './sync-mirrors.js';

const upstream = fs.mkdtempSync(path.join(os.tmpdir(), 'library-job-up-'));
const url = makeRepo(upstream, { 'docs/a.md': '# A', 'docs/b.md': '# B' });
const mirror = {
  id: 'docs',
  repo: 'acme/docs',
  subdir: 'docs',
  dest: 'library/docs',
};

const baseDir = useTempConfig({ library: { mirrors: [mirror] } });
const deps = () => ({ ...libraryDeps(), run, cloneUrl: () => url });

let logged: string[];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((l: string) => {
    logged.push(l);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(path.join(baseDir(), 'state'), { recursive: true, force: true });
  fs.rmSync(path.join(baseDir(), 'content'), { recursive: true, force: true });
});
afterAll(() => {
  fs.rmSync(upstream, { recursive: true, force: true });
});

describe('library-sync-mirrors runnable', () => {
  it('ships a manifest that is off, daily at 04:10 UTC', () => {
    expect(
      readCoreManifests().find((m) => m.id === 'library-sync-mirrors'),
    ).toEqual({
      id: 'library-sync-mirrors',
      domain: 'library',
      name: 'Library Sync Mirrors',
      description:
        'Mirror configured public-repo subdirectories into the content tree as reference libraries (checksum rsync, .meta preserved).',
      schedule: { freq: 'daily', byhour: 4, byminute: 10, timezone: 'UTC' },
      overlap_policy: 'skip',
      timeout_seconds: 600,
      enabled: false,
      prerequisite: null,
    });
  });

  it('is registered in the library domain and accepts only --live', async () => {
    const entry = coreJobs.find((e) => e.id === 'library-sync-mirrors');
    if (!entry) throw new Error('library-sync-mirrors is not registered');
    expect(entry.domain).toBe('library');
    const job = await loadJob(entry);
    expect(Object.keys(job.flags ?? {})).toEqual(['live']);
    // git and rsync are on PATH wherever these tests run (CI installs rsync).
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
  });

  it('dry run by default: reads the config, mirrors into the stage only', () => {
    runMirrors({}, deps());
    const root = path.join(baseDir(), 'state', 'library', 'docs');
    expect(listFiles(path.join(root, 'stage')).sort()).toEqual([
      'a.md',
      'b.md',
    ]);
    expect(fs.existsSync(path.join(baseDir(), 'content'))).toBe(false);
    expect(logged).toContain(
      '[library-sync-mirrors] DRY RUN: pass --live to write',
    );
  });

  it('--live writes the mirror under the content dir', () => {
    runMirrors({ live: true }, deps());
    expect(
      listFiles(path.join(baseDir(), 'content', 'library', 'docs')).sort(),
    ).toEqual(['a.md', 'b.md']);
    expect(logged.some((l) => l.startsWith('JR_RESULT:'))).toBe(true);
  });
});

describe('libraryPrerequisite', () => {
  const mirrors = [libraryMirrorSchema.parse(mirror)];

  it('skips when no mirror is configured, before checking any tool', () => {
    const has = vi.fn(() => true);
    expect(libraryPrerequisite([], has)).toBe(NO_MIRRORS);
    expect(has).not.toHaveBeenCalled();
  });

  it('is met when git and rsync are both on PATH', () => {
    expect(libraryPrerequisite(mirrors, () => true)).toBe(true);
  });

  it('names whichever of git and rsync is missing', () => {
    expect(libraryPrerequisite(mirrors, (c) => c !== 'rsync')).toBe(
      'rsync not found on PATH (library-sync-mirrors needs git and rsync)',
    );
    expect(libraryPrerequisite(mirrors, () => false)).toMatch(
      /^git and rsync not found on PATH/,
    );
  });
});

describe('onPath', () => {
  it('finds git and not a command that does not exist', () => {
    expect(onPath('git')).toBe(true);
    expect(onPath('no-such-command-for-library-tests')).toBe(false);
  });
});
