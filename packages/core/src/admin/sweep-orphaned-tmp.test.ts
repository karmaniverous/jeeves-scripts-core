import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import job, { sweepTargets } from './sweep-orphaned-tmp.js';

const savedEnv = process.env[CONFIG_PATH_ENV];
let dir: string;

/** Point the loader at a config with the given `jobs` block. */
const useConfig = (jobs: Record<string, unknown>): void => {
  const file = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ instance: { name: 'test', baseDir: '/base' }, jobs }),
  );
  process.env[CONFIG_PATH_ENV] = file;
  resetConfig();
};

const posix = (ps: string[]) => ps.map((p) => p.replace(/\\/g, '/'));

describe('admin-sweep-orphaned-tmp', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-sweep-job-'));
  });

  afterEach(() => {
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is the admin runnable with its crash-log label', () => {
    expect(job.id).toBe('admin-sweep-orphaned-tmp');
    expect(job.domain).toBe('admin');
    expect(job.name).toBe('core/sweep-orphaned-tmp');
  });

  it('sweeps the content and scripts directories by default', () => {
    useConfig({});
    expect(posix(sweepTargets())).toEqual([
      '/base/content',
      '/base/jeeves-scripts',
    ]);
  });

  it('adds jobs.admin-sweep-orphaned-tmp.extraDirs after them', () => {
    useConfig({
      'admin-sweep-orphaned-tmp': { extraDirs: ['/work', 'D:/other'] },
      'admin-check-qdrant-health': { enabled: false },
    });
    expect(posix(sweepTargets())).toEqual([
      '/base/content',
      '/base/jeeves-scripts',
      '/work',
      'D:/other',
    ]);
  });
});
