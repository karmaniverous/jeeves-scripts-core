import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { buildProgram, main, resolveRoot } from './index.js';

const root = path.resolve('/instance');

describe('jeeves-scripts CLI', () => {
  // test/setup.ts points JEEVES_SCRIPTS_CONFIG at a shared test config;
  // these tests exercise root/--config resolution, so unset it here.
  const savedEnv = process.env[CONFIG_PATH_ENV];

  beforeEach(() => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    resetConfig();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
    process.exitCode = undefined;
  });

  it('config check prints OK for a valid config under the root', async () => {
    const read = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(
        JSON.stringify({ instance: { name: 'test', baseDir: 'J:/' } }),
      );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await buildProgram({ root }).parseAsync(['config', 'check'], {
      from: 'user',
    });

    expect(read).toHaveBeenCalledWith(
      path.join(root, 'jeeves-scripts.json'),
      'utf8',
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('config check: OK'),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('config check --config prints FAILED and sets exit code 1', async () => {
    const read = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(JSON.stringify({ instance: { name: 'test' } }));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await buildProgram({ root }).parseAsync(
      ['config', 'check', '--config', '/elsewhere/c.json'],
      { from: 'user' },
    );

    expect(read).toHaveBeenCalledWith('/elsewhere/c.json', 'utf8');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('config check: FAILED'),
    );
    expect(process.exitCode).toBe(1);
  });

  it('main accepts a file URL root, as the launcher passes it, and returns the exit code', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test', baseDir: 'J:/' } }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await main({
      root: pathToFileURL(root + path.sep),
      argv: ['node', 'jeeves-scripts', 'config', 'check'],
    });

    expect(code).toBe(0);
  });

  it('resolveRoot passes paths through and converts file URLs', () => {
    expect(resolveRoot(root)).toBe(root);
    expect(resolveRoot(pathToFileURL(root))).toBe(root);
  });
});
