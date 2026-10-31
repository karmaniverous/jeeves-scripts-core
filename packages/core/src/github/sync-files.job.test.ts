/**
 * `github-sync-files` as a registered job: it is in the registry with a
 * manifest that ships off (daily 04:30 UTC, overlap skip, 600 s, the
 * GitHub prerequisite); unconfigured (no delta, or no `files` or `owners`)
 * it logs the skip line and makes no `gh` call; a missing gh config dir
 * skips like every GitHub job; configured, it reads the delta from the
 * instance config and its sources from `paths.scriptsDir`, dry unless
 * `--live`. The delta's new fields are validated by the config schema.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { jobDeltaSchema } from '../config/jobs-schema.js';
import { loadConfig } from '../config/loader.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import { readCoreManifests } from '../runnables/manifest.js';
import { coreJobs, loadJob } from '../runnables/registry.js';
import {
  ACCOUNT,
  CONTENT,
  ORG,
  RULESET,
  SOURCE,
  TARGET,
  useSyncFilesWorld,
} from './lib/file-sync-gh.test-helper.js';
import { SYNC_FILES_SKIP, syncFiles } from './sync-files.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-files-job-'));
fs.mkdirSync(path.join(root, 'github'));
fs.writeFileSync(path.join(root, SOURCE), CONTENT);

const delta = {
  files: [{ source: SOURCE, target: TARGET }],
  owners: [{ owner: ORG, type: 'org' as const }],
  account: ACCOUNT,
};

useTempConfig({
  paths: { scriptsDir: root },
  jobs: { 'github-sync-files': delta },
});

const world = useSyncFilesWorld();
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('github-sync-files job', () => {
  it('ships a manifest that is off, daily at 04:30 UTC', () => {
    const entry = readCoreManifests().find((m) => m.id === 'github-sync-files');
    expect(entry).toMatchObject({
      domain: 'github',
      name: 'GitHub Sync Files',
      schedule: { freq: 'daily', byhour: 4, byminute: 30, timezone: 'UTC' },
      overlap_policy: 'skip',
      timeout_seconds: 600,
      enabled: false,
      prerequisite: 'GitHub CLI auth (gh auth login)',
    });
  });

  it.each([
    ['an empty delta', {}],
    ['no files', { owners: delta.owners }],
    ['empty files', { ...delta, files: [] }],
    ['no owners', { files: delta.files }],
    ['empty owners', { ...delta, owners: [] }],
  ])('skips with %s, before any gh call', (_what, d) => {
    const deps = vi.fn();
    syncFiles({ live: true }, d, deps);
    expect(console.log).toHaveBeenCalledWith(
      "[skip] jobs['github-sync-files'].files/owners is not configured",
    );
    expect(deps).not.toHaveBeenCalled();
  });

  it('skips like every GitHub job when the gh config dir is missing', () => {
    const w = world();
    w.deps.configDir = path.join(w.dir, 'absent');
    syncFiles({ live: true }, delta, () => w.deps);
    expect(console.log).toHaveBeenCalledWith(
      '[skip] GitHub CLI config not configured',
    );
    expect(w.ghCalls).toEqual([]);
  });

  it('reads the delta from the config and the sources from paths.scriptsDir; dry unless --live', () => {
    const w = world();
    syncFiles({}, undefined, () => w.deps);
    expect(w.writes()).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(
      '[github-sync-files] DRY RUN: pass --live to write',
    );
    syncFiles({ live: true }, undefined, () => w.deps);
    expect(w.writes()).toEqual([
      expect.stringMatching(new RegExp(`^api /repos/${ORG}/stale/contents/`)),
    ]);
  });

  it('is registered, and runs from the registry with no delta configured: it skips', async () => {
    const entry = coreJobs.find((e) => e.id === 'github-sync-files');
    if (!entry) throw new Error('github-sync-files is not registered');
    expect(entry.domain).toBe('github');
    const job = await loadJob(entry);
    const jobs = loadConfig().jobs;
    const saved = jobs['github-sync-files'];
    Reflect.deleteProperty(jobs, 'github-sync-files');
    try {
      await job.run({ args: ['--live'] });
    } finally {
      jobs['github-sync-files'] = saved!;
    }
    expect(console.log).toHaveBeenCalledWith(SYNC_FILES_SKIP);
  });
});

describe('the github-sync-files delta fields', () => {
  it('accepts the documented shape', () => {
    const parsed = jobDeltaSchema.parse({
      ...delta,
      owners: [
        {
          owner: ORG,
          type: 'org',
          ruleset: false,
          include: ['*/web-*'],
          exclude: ['*/old'],
        },
      ],
      ruleset: RULESET,
    });
    expect(parsed.ruleset).toEqual(RULESET);
  });

  it.each([
    ['a target starting with /', { files: [{ source: 'a', target: '/a' }] }],
    ['an empty source', { files: [{ source: '', target: 'a' }] }],
    ['an empty owner', { owners: [{ owner: '', type: 'org' }] }],
    ['an unknown owner type', { owners: [{ owner: 'o', type: 'team' }] }],
    ['an empty account', { account: '' }],
    [
      'a ruleset without rules',
      { ruleset: { name: 'n', target: 'branch', enforcement: 'active' } },
    ],
  ])('rejects %s', (_what, d) => {
    expect(jobDeltaSchema.safeParse(d).success).toBe(false);
  });

  it.each([
    ['/etc/passwd', /source must be a relative path/],
    ['\\\\host\\share\\key', /source must be a relative path/],
    ['C:/Users/x/.config/gh/hosts.yml', /source must be a relative path/],
    ['c:key', /source must be a relative path/],
    ['../../.ssh/id_rsa', /source must not contain a \.\. segment/],
    ['github/../../x', /source must not contain a \.\. segment/],
    ['./', /source must name a file/],
  ])('rejects files[].source %s', (source, message) => {
    const r = jobDeltaSchema.safeParse({ files: [{ source, target: 'a' }] });
    expect(r.error?.issues.map((i) => i.message).join('; ')).toMatch(message);
  });

  it('accepts a nested relative source', () => {
    expect(
      jobDeltaSchema.safeParse({
        files: [{ source: 'github/./copilot.md', target: 'a' }],
      }).success,
    ).toBe(true);
  });
});
