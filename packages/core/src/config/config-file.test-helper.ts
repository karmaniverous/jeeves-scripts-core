/**
 * @module config/config-file.test-helper
 *
 * Write a fresh instance config per test and point `JEEVES_SCRIPTS_CONFIG`
 * at it: for tests that load different configs in one suite. Test
 * support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from './loader.js';

/**
 * Register hooks that give each test a temp dir; returns a writer that
 * saves `blocks` (with an `instance` whose `baseDir` is that dir) as the
 * loaded config and returns its path as `{ configPath }`.
 */
export const useConfigFile = (): ((blocks: object) => {
  configPath: string;
}) => {
  let dir = '';
  const savedEnv = process.env[CONFIG_PATH_ENV];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-config-file-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  afterAll(() => {
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
  });
  return (blocks) => {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ instance: { name: 'test', baseDir: dir }, ...blocks }),
    );
    process.env[CONFIG_PATH_ENV] = configPath;
    resetConfig();
    return { configPath };
  };
};
