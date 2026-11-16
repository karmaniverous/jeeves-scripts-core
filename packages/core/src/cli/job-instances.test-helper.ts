/**
 * @module cli/job-instances.test-helper
 *
 * The instance the job-instance tests share (Decision 80): a runnable with
 * a configSchema that dispatches a task file, run as itself and as two
 * jobs, plus a runnable without one and a manifest-less core runnable.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';
import { z } from 'zod';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import type { TaskFileDispatcherDeps } from '../dispatchers/lib/task-file-dispatcher.js';
import { taskFileDispatcher } from '../dispatchers/lib/task-file-dispatcher.js';
import { dispatcherFlags } from '../lib/dispatcher-flags.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import type { JobManifest } from '../runnables/manifest.js';
import { definePlugin } from '../runnables/plugin.js';
import type { RegistryEntry } from '../runnables/registry.js';
import type { RunJobDeps } from '../runnables/run-job.js';

let rootDir = '';
/** The temp instance root. */
export const root = (): string => rootDir;
const saved = process.env[CONFIG_PATH_ENV];
const savedArgv = process.argv;

/** What each run saw. */
export const runs: {
  jobId: string;
  argv: string | undefined;
  config: unknown;
}[] = [];
export const dispatchDeps = {
  dispatchWithSlack: vi.fn<TaskFileDispatcherDeps['dispatchWithSlack']>(),
  runDispatcher: vi.fn<TaskFileDispatcherDeps['runDispatcher']>(),
  now: () => new Date('2026-11-16T12:00:00Z'),
  log: vi.fn<(message: string) => void>(),
};
const dispatch = taskFileDispatcher(
  { scriptName: 'acme/brief', taskFile: 'brief/TASK.md' },
  dispatchDeps,
);

export const brief = defineRunnable({
  id: 'acme-brief',
  domain: 'acme',
  flags: dispatcherFlags,
  configSchema: z.object({
    channel: z.string(),
    recipients: z.array(z.string()),
  }),
  run: async (ctx) => {
    runs.push({
      jobId: ctx.jobId,
      argv: process.argv[1],
      config: ctx.config,
    });
    await dispatch(ctx);
  },
});

export const plain = defineRunnable({
  id: 'acme-plain',
  domain: 'acme',
  description: 'No config.',
  run: () => undefined,
});

/** A core runnable without a manifest, so an instance job may run it. */
export const coreEntry: RegistryEntry = {
  id: 'email-inventory',
  domain: 'email',
  module: 'email/inventory',
  load: () =>
    Promise.resolve({
      default: defineRunnable({
        id: 'email-inventory',
        domain: 'email',
        description: 'Count threads.',
        configSchema: z.object({ folder: z.string().default('INBOX') }),
        run: () => undefined,
      }),
    }),
};

export const entryFields = {
  overlap_policy: 'skip',
  enabled: true,
  prerequisite: null,
};

/** The instance's acme manifest: the runnable's own entry and two jobs. */
export const acmeManifest = (extra: Record<string, unknown> = {}) => ({
  'acme-brief': {
    ...entryFields,
    name: 'Brief',
    description: 'The brief.',
    schedule: '0 6 * * *',
  },
  'acme-brief-industry': {
    ...entryFields,
    runnable: 'acme-brief',
    name: 'Industry brief',
    description: 'The industry brief.',
    schedule: '0 7 * * 1-5',
    timeout_seconds: 600,
    on_failure: 'C000EXAMPLE2',
    env: { BRIEF: 'industry' },
    args: ['--dry-run'],
  },
  'acme-brief-clinical': {
    ...entryFields,
    runnable: 'acme-brief',
    name: 'Clinical brief',
    description: 'The clinical brief.',
    schedule: { freq: 'weekly', byweekday: 0, timezone: 'UTC' },
  },
  ...extra,
});

export const writeManifests = (
  files: Record<string, Record<string, unknown>>,
) => {
  const dir = path.join(rootDir, 'jobs');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  for (const [name, entries] of Object.entries(files))
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(entries));
};

export const baseJobs = {
  'acme-brief': {
    config: { channel: 'C000EXAMPLE1', recipients: ['jane@example.com'] },
  },
  'acme-brief-clinical': { config: { recipients: ['john@example.com'] } },
  'acme-brief-industry': { enabled: false, env: { EXTRA: '1' } },
};

export const writeConfig = (jobs: Record<string, unknown> = baseJobs) => {
  fs.writeFileSync(
    path.join(rootDir, 'jeeves-scripts.json'),
    JSON.stringify({
      instance: { name: 't', baseDir: rootDir },
      paths: { contentDir: path.join(rootDir, 'content') },
      jobs,
    }),
  );
  resetConfig();
};

export const options = {
  registry: [coreEntry],
  coreManifests: [] as JobManifest[],
  loadPlugin: () => Promise.resolve(definePlugin({ jobs: [brief, plain] })),
};

/** runJob seams: record each crash label, run the body. */
export const labels: string[] = [];
export const runDeps: RunJobDeps = {
  runScript: (name, fn) => {
    labels.push(name);
    void fn();
  },
  log: () => undefined,
};

/** Set up a fresh instance around every test in the calling file. */
export const useJobInstancesSandbox = (): void => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-job-instances-'));
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    fs.mkdirSync(path.join(rootDir, 'content', 'brief'), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, 'content', 'brief', 'TASK.md'),
      'Brief.',
    );
    writeConfig();
    writeManifests({ acme: acmeManifest() });
    runs.length = 0;
    labels.length = 0;
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = savedArgv;
    resetConfig();
    if (saved === undefined)
      Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    else process.env[CONFIG_PATH_ENV] = saved;
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
};
