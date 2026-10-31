/**
 * @module dispatchers/lib/task-file-dispatcher.test-helper
 *
 * The sandbox the task-file dispatcher tests share: a temp instance with a
 * config (a default silo and an `acme` silo), helpers to write the config
 * and task files, and injectable dependencies. Registers its own
 * `beforeEach` / `afterEach`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../../config/loader.js';
import type { TaskFileDispatcherDeps } from './task-file-dispatcher.js';

/** The sandbox handle. */
export interface DispatcherSandbox {
  /** The temp instance root. */
  dir: () => string;
  /** (Re)write the instance config with these job deltas. */
  writeConfig: (jobs?: Record<string, unknown>) => void;
  /** Write a file under the root; returns its path. */
  writeTask: (rel: string, text?: string) => string;
  /** Fresh mock dependencies. */
  makeDeps: () => {
    dispatchWithSlack: ReturnType<
      typeof vi.fn<TaskFileDispatcherDeps['dispatchWithSlack']>
    >;
    runDispatcher: ReturnType<
      typeof vi.fn<TaskFileDispatcherDeps['runDispatcher']>
    >;
    now: () => Date;
    log: ReturnType<typeof vi.fn<(message: string) => void>>;
  };
}

/** Set up a fresh sandbox around every test in the calling file. */
export const useDispatcherSandbox = (): DispatcherSandbox => {
  let dir = '';
  let savedEnv: string | undefined;

  const writeConfig = (jobs: Record<string, unknown> = {}): void => {
    const configPath = path.join(dir, 'jeeves-scripts.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        instance: { name: 't', baseDir: dir },
        paths: { contentDir: path.join(dir, 'content') },
        siloRouting: {
          silos: { acme: { basePath: path.join(dir, 'acme') } },
        },
        jobs,
      }),
    );
    process.env[CONFIG_PATH_ENV] = configPath;
    resetConfig();
  };

  beforeEach(() => {
    savedEnv = process.env[CONFIG_PATH_ENV];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfd-'));
    writeConfig();
  });

  afterEach(() => {
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return {
    dir: () => dir,
    writeConfig,
    writeTask: (rel, text = 'Do the thing.') => {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    },
    makeDeps: () => {
      const deps = {
        dispatchWithSlack: vi.fn<TaskFileDispatcherDeps['dispatchWithSlack']>(),
        runDispatcher: vi.fn<TaskFileDispatcherDeps['runDispatcher']>(),
        now: () => new Date('2026-05-11T12:00:00Z'),
        log: vi.fn<(message: string) => void>(),
      };
      deps.dispatchWithSlack.mockResolvedValue({
        task: '',
        posts: [],
        posted: 0,
      });
      return deps;
    },
  };
};
