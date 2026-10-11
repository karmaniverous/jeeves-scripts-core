/**
 * @module lib/temp-config.test-helper
 *
 * Pin a suite to a temp `jeeves-scripts.json`: the shared test config with
 * `instance.baseDir` moved to a temp directory (so config-routed paths such
 * as the email thread cache land there) plus the given blocks. Test
 * support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';

/**
 * Register suite hooks that write and pin the temp config; returns a
 * getter for the temp base directory (valid inside tests).
 *
 * @param blocks - Top-level blocks merged over the shared test config.
 */
export const useTempConfig = (
  blocks: Record<string, unknown> = {},
): (() => string) => {
  let dir = '';
  const savedEnv = process.env[CONFIG_PATH_ENV];

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-temp-config-'));
    const base = JSON.parse(fs.readFileSync(savedEnv ?? '', 'utf8')) as Record<
      string,
      unknown
    >;
    const instance = { ...(base.instance as object), baseDir: dir };
    const configPath = path.join(dir, 'jeeves-scripts.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ...base, instance, ...blocks }),
    );
    process.env[CONFIG_PATH_ENV] = configPath;
    resetConfig();
  });

  afterAll(() => {
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
};
