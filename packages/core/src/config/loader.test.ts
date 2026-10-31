import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONFIG_PATH_ENV,
  getConfigRoot,
  getLoadedConfigPath,
  getLoadedConfigSource,
  LEGACY_CONFIG_WARNING,
  loadConfig,
  resetConfig,
  resolveConfig,
  resolveConfigPath,
  ROOT_ENV,
  setConfigRoot,
} from './loader.js';

const VALID_CONFIG = JSON.stringify({
  instance: { name: 'test', baseDir: '/base' },
});

let tmp: string;
const put = (rel: string, value: unknown): string => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};

describe('resolveConfig (#57)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-'));
    resetConfig();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    vi.restoreAllMocks();
    resetConfig();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const full = JSON.parse(VALID_CONFIG) as unknown;

  it('prefers an explicit configPath, then the env var, then {root}/jeeves-scripts.json', () => {
    const option = put('c.json', full);
    const env = put('env.json', full);
    put('repo/jeeves-scripts.json', full);
    process.env[CONFIG_PATH_ENV] = env;
    expect(
      resolveConfig({ root: path.join(tmp, 'repo'), configPath: option }),
    ).toEqual({ path: option, source: 'option' });
    expect(resolveConfig({ root: path.join(tmp, 'repo') })).toEqual({
      path: env,
      source: 'environment',
    });
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    expect(resolveConfigPath({ root: path.join(tmp, 'repo') })).toBe(
      path.join(tmp, 'repo', 'jeeves-scripts.json'),
    );
  });

  it('throws when nothing can resolve the path', () => {
    expect(() => resolveConfigPath({})).toThrow(/Cannot resolve/);
  });

  it('follows a pointer to <config>/config.json', () => {
    const target = put('cfg/config.json', full);
    const pointer = put('repo/jeeves-scripts.json', {
      $schema: 'x',
      config: path.join(tmp, 'cfg'),
    });
    expect(resolveConfig({ root: path.join(tmp, 'repo') })).toEqual({
      path: target,
      source: 'pointer',
      pointer,
    });
    expect(loadConfig({ root: path.join(tmp, 'repo') }).instance.name).toBe(
      'test',
    );
    expect(getLoadedConfigPath()).toBe(target);
    expect(getLoadedConfigSource()).toBe('pointer');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('names the pointer and the missing config file', () => {
    const pointer = put('repo/jeeves-scripts.json', {
      config: path.join(tmp, 'nope'),
    });
    expect(() => resolveConfig({ root: path.join(tmp, 'repo') })).toThrow(
      new RegExp(
        `${pointer.replace(/[\\.]/g, '\\$&')}.*config\\.json does not exist`,
      ),
    );
  });

  it('rejects a pointer to a relative directory', () => {
    put('repo/jeeves-scripts.json', { config: 'relative/dir' });
    expect(() => resolveConfig({ root: path.join(tmp, 'repo') })).toThrow(
      /must be an absolute directory/,
    );
  });

  it('rejects a file that is neither a pointer nor a full config', () => {
    put('repo/jeeves-scripts.json', { something: 1 });
    expect(() => resolveConfig({ root: path.join(tmp, 'repo') })).toThrow(
      /neither a config pointer/,
    );
  });

  it('uses a full config still in the repo, warning once per process', () => {
    put('repo/jeeves-scripts.json', full);
    const root = path.join(tmp, 'repo');
    expect(resolveConfig({ root }).source).toBe('legacy');
    resolveConfig({ root });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(LEGACY_CONFIG_WARNING);
  });

  it('resolves a bare loadConfig() from the root the launcher registered', () => {
    const target = put('cfg/config.json', full);
    put('repo/jeeves-scripts.json', { config: path.join(tmp, 'cfg') });
    setConfigRoot(path.join(tmp, 'repo'));
    try {
      loadConfig();
      expect(getLoadedConfigPath()).toBe(target);
    } finally {
      setConfigRoot(undefined);
    }
  });

  it('keeps the root in the environment, so another copy of core sees it (#62 CI)', () => {
    setConfigRoot('/inst');
    try {
      expect(process.env[ROOT_ENV]).toBe('/inst');
      expect(getConfigRoot()).toBe('/inst');
    } finally {
      setConfigRoot(undefined);
    }
    expect(process.env[ROOT_ENV]).toBeUndefined();
  });

  it('lets JEEVES_SCRIPTS_CONFIG win over the registered root', () => {
    const env = put('env.json', full);
    process.env[CONFIG_PATH_ENV] = env;
    setConfigRoot(path.join(tmp, 'nowhere'));
    try {
      expect(resolveConfig()).toEqual({ path: env, source: 'environment' });
    } finally {
      setConfigRoot(undefined);
    }
  });
  it('treats the repo file named by --config or the env as legacy too (#62 review)', () => {
    const repoFile = put('repo/jeeves-scripts.json', full);
    const root = path.join(tmp, 'repo');
    expect(resolveConfig({ root, configPath: repoFile }).source).toBe('legacy');
    process.env[CONFIG_PATH_ENV] = repoFile;
    expect(resolveConfig({ root }).source).toBe('legacy');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for a full config named directly', () => {
    resolveConfig({ configPath: put('c.json', full) });
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('loadConfig', () => {
  beforeEach(() => {
    resetConfig();
    vi.spyOn(fs, 'readFileSync').mockReturnValue(VALID_CONFIG);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
