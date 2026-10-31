import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configCheck, describeConfigSource } from './check.js';
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
      JSON.stringify({ instance: { name: 'test', baseDir: '/base' } }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.configPath?.replace(/\\/g, '/')).toBe(
      '/root/jeeves-scripts.json',
    );
  });

  it('fails with the schema error when the config is invalid, naming the file', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ instance: { name: 'test' } }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/failed validation/);
    expect(result.configPath?.replace(/\\/g, '/')).toBe(
      '/root/jeeves-scripts.json',
    );
  });

  it('leaves configPath unset when the location cannot be resolved', () => {
    const result = configCheck({});
    expect(result.ok).toBe(false);
    expect(result.configPath).toBeUndefined();
    expect(result.errors[0]).toMatch(/Cannot resolve the config file location/);
  });

  it('fails when an X account names an unknown silo (R10)', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        instance: { name: 'test', baseDir: '/base' },
        siloRouting: { silos: { acme: { basePath: '/srv/acme' } } },
        integrations: {
          x: {
            accounts: { known: { silo: 'acme' }, lost: { silo: 'initech' } },
          },
        },
      }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'integrations.x.accounts.lost.silo: unknown silo "initech". Configured silos: acme.',
    ]);
  });

  it('fails when a job names an unknown silo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        instance: { name: 'test', baseDir: '/base' },
        siloRouting: {
          silos: { acme: { basePath: '/srv/acme' } },
        },
        jobs: { 'daily-briefing': { silo: 'initech' } },
      }),
    );
    const result = configCheck(options);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/unknown silo "initech"/);
  });

  it('passes when a job names a known silo', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        instance: { name: 'test', baseDir: '/base' },
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

describe('config source (#57)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-src-'));
    resetConfig();
  });
  afterEach(() => {
    resetConfig();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports a pointer and the file it names', () => {
    fs.mkdirSync(path.join(tmp, 'cfg'));
    fs.writeFileSync(
      path.join(tmp, 'cfg', 'config.json'),
      JSON.stringify({ instance: { name: 't', baseDir: '/base' } }),
    );
    const pointer = path.join(tmp, 'jeeves-scripts.json');
    fs.writeFileSync(
      pointer,
      JSON.stringify({ config: path.join(tmp, 'cfg') }),
    );
    const result = configCheck({ configPath: pointer });
    expect(result).toMatchObject({
      ok: true,
      configPath: path.join(tmp, 'cfg', 'config.json'),
      source: { source: 'pointer', pointer },
    });
    expect(describeConfigSource(result.source)).toBe(`pointer ${pointer}`);
  });

  it('reports the source of an invalid config too', () => {
    const file = path.join(tmp, 'c.json');
    fs.writeFileSync(file, JSON.stringify({ instance: { name: 't' } }));
    expect(configCheck({ configPath: file })).toMatchObject({
      ok: false,
      configPath: file,
      source: { source: 'option' },
    });
  });

  it.each([
    [{ source: 'environment' as const }, 'JEEVES_SCRIPTS_CONFIG'],
    [{ source: 'option' as const }, '--config'],
    [{ source: 'legacy' as const }, 'legacy repo file'],
    [undefined, undefined],
  ])('describes %o as %s', (source, text) => {
    expect(describeConfigSource(source)).toBe(text);
  });
});
