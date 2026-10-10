import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configCheck } from './check.js';
import { CONFIG_PATH_ENV, resetConfig } from './loader.js';

const options = { root: '/root' };

describe('configCheck', () => {
  // test/setup.ts points JEEVES_SCRIPTS_CONFIG at a shared test config;
  // these tests exercise root/configPath resolution, so unset it here.
  const savedEnv = process.env[CONFIG_PATH_ENV];

  beforeEach(() => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    resetConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
  });

  it('passes for a valid config with no job silo references', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test', baseDir: 'J:/' } }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.configPath?.replace(/\\/g, '/')).toBe(
      '/root/jeeves-scripts.json',
    );
  });

  it('fails with the schema error when the config is invalid', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test' } }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/failed validation/);
  });

  it('fails when a job names an unknown silo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        instance: { name: 'test', baseDir: 'J:/' },
        siloRouting: {
          silos: { acme: { basePath: '/srv/acme' } },
        },
        jobs: { 'vc-daily-briefing': { silo: 'tcs' } },
      }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unknown silo "tcs"/);
  });

  it('passes when a job names a known silo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        instance: { name: 'test', baseDir: 'J:/' },
        siloRouting: {
          silos: { acme: { basePath: '/srv/acme' } },
        },
        jobs: { 'acme-daily-briefing': { silo: 'acme' } },
      }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(true);
  });
});
