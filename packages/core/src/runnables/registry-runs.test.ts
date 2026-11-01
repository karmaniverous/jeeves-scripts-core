/**
 * Registry-wide contract (SOLID-1): every core runnable's `run` returns or
 * awaits its work. Each job runs with no loadable instance config, so
 * its work fails at its first config read; that failure must arrive through
 * what `run` returned (a rejected promise, or a synchronous throw), never as
 * an unhandled rejection after `run` has returned. Its source must not
 * contain `.catch(` or `void`, the two ways to silence the lint rule
 * against floating promises. A `run` that fires and forgets an async body
 * fails this test or the lint gate. Each module is imported under the
 * broken config, so one that reads config at import fails too.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { resetLocalConfig } from './plugin.js';
import { coreJobs, loadJob } from './registry.js';

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};
let dir: string;
let savedConfig: string | undefined;
let savedDb: string | undefined;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-runs-'));
  savedConfig = process.env[CONFIG_PATH_ENV];
  savedDb = process.env.JR_DB_PATH;
  process.env[CONFIG_PATH_ENV] = path.join(dir, 'missing.json');
  process.env.JR_DB_PATH = path.join(dir, 'runner.sqlite');
  resetConfig();
  resetLocalConfig();
  vi.stubGlobal('fetch', () =>
    Promise.reject(new Error('network disabled in test')),
  );
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.on('unhandledRejection', onUnhandled);
});

afterAll(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedConfig === undefined)
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = savedConfig;
  if (savedDb === undefined) Reflect.deleteProperty(process.env, 'JR_DB_PATH');
  else process.env.JR_DB_PATH = savedDb;
  resetConfig();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Let any fire-and-forget continuation run and reject. */
const drain = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Call `run` and report how its work ended. */
const settle = async (
  run: () => unknown,
): Promise<'resolved' | 'rejected' | 'threw'> => {
  try {
    const returned = run();
    if (!(returned instanceof Promise)) return 'resolved';
    return await returned.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
  } catch {
    return 'threw';
  }
};

describe('every core runnable', () => {
  it.each(coreJobs.map((e) => [e.id, e] as const))(
    '%s settles its work through what run returns',
    async (_id, entry) => {
      // Importing with no loadable config also proves the module reads
      // config at run time, never at import.
      const job = await loadJob(entry);
      // No fire-and-forget: a dangling promise in a block body is a lint
      // error (no-floating-promises), so only .catch( and void could hide one.
      expect(job.run.toString()).not.toMatch(/\.catch\(|\bvoid\s/);
      unhandled.length = 0;
      const settled = await settle(() => job.run({ args: [], flags: {} }));
      await drain();
      expect(unhandled).toEqual([]);
      expect(['resolved', 'rejected', 'threw']).toContain(settled);
      process.exitCode = undefined;
    },
  );
});
