import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONFIG_PATH_ENV,
  getLoadedConfigPath,
  loadConfig,
  resetConfig,
  resolveConfigPath,
} from './loader.js';

const VALID_CONFIG = JSON.stringify({
  instance: { name: 'test', baseDir: 'J:/' },
});

describe('resolveConfigPath', () => {
  afterEach(() => {
    delete process.env[CONFIG_PATH_ENV];
  });

  it('prefers an explicit configPath', () => {
    expect(resolveConfigPath({ root: 'r', configPath: 'c.json' })).toBe(
      'c.json',
    );
  });

  it('falls back to the env var', () => {
    process.env[CONFIG_PATH_ENV] = 'env.json';
    expect(resolveConfigPath({ root: 'r' })).toBe('env.json');
  });

  it('falls back to {root}/jeeves-scripts.json', () => {
    expect(
      resolveConfigPath({ root: '/opt/jeeves/jeeves-scripts' }).replace(
        /\\/g,
        '/',
      ),
    ).toBe('/opt/jeeves/jeeves-scripts/jeeves-scripts.json');
  });

  it('throws when nothing can resolve the path', () => {
    expect(() => resolveConfigPath({})).toThrow();
  });
});

describe('loadConfig', () => {
  beforeEach(() => {
    resetConfig();
    vi.spyOn(fs, 'readFileSync').mockReturnValue(VALID_CONFIG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfig();
  });

  it('loads and validates the config', () => {
    const config = loadConfig({ root: '/root' });
    expect(config.instance.name).toBe('test');
    expect(getLoadedConfigPath()?.replace(/\\/g, '/')).toBe(
      '/root/jeeves-scripts.json',
    );
  });

  it('caches the config on subsequent calls', () => {
    loadConfig({ root: '/root' });
    loadConfig({ root: '/root' });
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it('reset clears the cache', () => {
    loadConfig({ root: '/root' });
    resetConfig();
    expect(getLoadedConfigPath()).toBeNull();
    loadConfig({ root: '/root' });
    expect(fs.readFileSync).toHaveBeenCalledTimes(2);
  });

  it('throws a clear error when the file cannot be read', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      const err = new Error('nope') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    expect(() => loadConfig({ root: '/root' })).toThrow(/could not be read/);
  });

  it('throws a clear error on invalid JSON', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{not json');
    expect(() => loadConfig({ root: '/root' })).toThrow(/not valid JSON/);
  });

  it('throws a clear error on schema validation failure', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test' } }),
    );
    expect(() => loadConfig({ root: '/root' })).toThrow(/failed validation/);
  });
});
