import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { definePlugin, resetLocalConfig } from '../runnables/plugin.js';
import { configEdit, type ConfigEditRequest } from './config-edit.js';
import { loadPlugin, PLUGIN_FILE } from './load-plugin.js';

let root: string;
let cfgDir: string;
let configFile: string;
const saved = process.env[CONFIG_PATH_ENV];

/** The real loader, with a plugin whose configSchema needs `local.channel`. */
const pluginWithSchema = (r: string) =>
  loadPlugin(r, {
    importTs: () =>
      Promise.resolve({
        default: definePlugin({
          configSchema: z.strictObject({ channel: z.string() }),
        }),
      }),
  });

const deps = {
  loadPlugin: pluginWithSchema,
  now: () => new Date('2026-10-30T12:00:00Z'),
};
const edit = (request: ConfigEditRequest) => configEdit(root, request, deps);
const read = () => JSON.parse(fs.readFileSync(configFile, 'utf8')) as unknown;
const temps = () => fs.readdirSync(cfgDir).filter((n) => n.endsWith('.tmp'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-config-edit-'));
  cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-config-dir-'));
  configFile = path.join(cfgDir, 'config.json');
  fs.writeFileSync(path.join(root, PLUGIN_FILE), '');
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      instance: { name: 't', baseDir: root },
      local: { channel: 'C0' },
    }),
  );
  fs.writeFileSync(
    path.join(root, 'jeeves-scripts.json'),
    JSON.stringify({ config: cfgDir }),
  );
  Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  resetConfig();
});

afterEach(() => {
  resetLocalConfig();
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cfgDir, { recursive: true, force: true });
});

describe('configEdit (#57)', () => {
  it('dry run: prints the change and writes nothing', async () => {
    const before = fs.readFileSync(configFile, 'utf8');
    const result = await edit({ path: 'local.channel', edit: { set: 'C9' } });
    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.lines).toEqual([
      `${configFile}:`,
      '- local.channel: "C0"',
      '+ local.channel: "C9"',
      'dry run: nothing written; rerun with --live to write it',
    ]);
    expect(fs.readFileSync(configFile, 'utf8')).toBe(before);
    expect(temps()).toEqual([]);
    expect(fs.readdirSync(cfgDir)).toEqual(['config.json']);
  });

  it('--live: backs up, writes the change and keeps the newest 20 backups', async () => {
    const before = fs.readFileSync(configFile, 'utf8');
    for (let i = 1; i <= 21; i++)
      fs.writeFileSync(
        path.join(
          cfgDir,
          `config.json.202609${String(i).padStart(2, '0')}T000000Z.bak`,
        ),
        'old',
      );
    const result = await edit({
      path: 'local.channel',
      edit: { set: 'C9' },
      live: true,
    });
    const backup = path.join(cfgDir, 'config.json.20261030T120000Z.bak');
    expect(result).toMatchObject({ ok: true });
    expect(result.lines.at(-1)).toBe(`written; backup ${backup}`);
    expect(read()).toMatchObject({ local: { channel: 'C9' } });
    expect(fs.readFileSync(backup, 'utf8')).toBe(before);
    const backups = fs
      .readdirSync(cfgDir)
      .filter((n) => n.endsWith('.bak'))
      .sort();
    expect(backups).toHaveLength(20);
    expect(backups[0]).toBe('config.json.20260903T000000Z.bak');
    expect(temps()).toEqual([]);
  });

  it('--live unset removes the key (with a plugin that has no configSchema)', async () => {
    const result = await configEdit(
      root,
      { path: 'local', edit: { unset: true }, live: true },
      {
        ...deps,
        loadPlugin: (r) =>
          loadPlugin(r, {
            importTs: () => Promise.resolve({ default: definePlugin({}) }),
          }),
      },
    );
    expect(result.ok).toBe(true);
    expect(read()).not.toHaveProperty('local');
  });

  it('rejects removing a block the plugin requires', async () => {
    const result = await edit({
      path: 'local',
      edit: { unset: true },
      live: true,
    });
    expect(result.ok).toBe(false);
    expect(read()).toHaveProperty('local');
  });

  it.each([
    ['the core schema', 'instance.baseDir', 3, /instance\.baseDir/],
    ["the plugin's configSchema", 'local.channel', 5, /channel/],
    ['the secret guard', 'jobs.x.apiKey', 'abc', /literal secret/],
  ])(
    'rejects a result %s rejects, writing nothing',
    async (_name, at, value, error) => {
      const before = fs.readFileSync(configFile, 'utf8');
      const result = await edit({ path: at, edit: { set: value }, live: true });
      expect(result.ok).toBe(false);
      expect(result.lines.at(-1)).toBe('not written: the result is invalid');
      expect(result.errors.join('\n')).toMatch(error);
      expect(fs.readFileSync(configFile, 'utf8')).toBe(before);
      expect(fs.readdirSync(cfgDir)).toEqual(['config.json']);
    },
  );

  it('refuses a config still in the instance repo', async () => {
    fs.writeFileSync(
      path.join(root, 'jeeves-scripts.json'),
      JSON.stringify({ instance: { name: 't', baseDir: root } }),
    );
    const result = await edit({
      path: 'local.channel',
      edit: { set: 'C9' },
      live: true,
    });
    expect(result).toMatchObject({ ok: false, lines: [] });
    expect(result.errors[0]).toMatch(/move it first/);
  });

  it.each([
    ['a bad path', { path: 'a..b', edit: { set: 1 } }, /Invalid config path/],
    [
      'removing a missing key',
      { path: 'nope', edit: { unset: true as const } },
      /nothing to remove/,
    ],
  ])('reports %s', async (_name, request, error) => {
    const result = await edit(request);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(error);
  });

  it('edits a full config named by --config', async () => {
    const result = await edit({
      path: 'local.channel',
      edit: { set: 'C9' },
      live: true,
      configPath: configFile,
    });
    expect(result.ok).toBe(true);
    expect(read()).toMatchObject({ local: { channel: 'C9' } });
  });
});

describe('configEdit review fixes (#62)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both backups of two edits in the same second', async () => {
    const first = fs.readFileSync(configFile, 'utf8');
    await edit({ path: 'local.channel', edit: { set: 'C1' }, live: true });
    const second = fs.readFileSync(configFile, 'utf8');
    await edit({ path: 'local.channel', edit: { set: 'C2' }, live: true });
    const b1 = path.join(cfgDir, 'config.json.20261030T120000Z.bak');
    const b2 = path.join(cfgDir, 'config.json.20261030T120000Z-2.bak');
    expect(fs.readFileSync(b1, 'utf8')).toBe(first);
    expect(fs.readFileSync(b2, 'utf8')).toBe(second);
  });

  it('leaves JEEVES_SCRIPTS_CONFIG as it found it', async () => {
    await edit({ path: 'local.channel', edit: { set: 'C1' }, live: true });
    expect(process.env[CONFIG_PATH_ENV]).toBeUndefined();
    const again = await edit({
      path: 'local.channel',
      edit: { set: 'C2' },
      live: true,
    });
    expect(again.ok).toBe(true);
    expect(read()).toMatchObject({ local: { channel: 'C2' } });
  });

  it('retries a rename Windows briefly refuses', async () => {
    const rename = fs.renameSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      rename(from, to);
    });
    const result = await configEdit(
      root,
      { path: 'local.channel', edit: { set: 'C9' }, live: true },
      { ...deps, sleep: () => Promise.resolve() },
    );
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
    expect(read()).toMatchObject({ local: { channel: 'C9' } });
  });

  it('reports a rename that keeps failing, without throwing', async () => {
    const before = fs.readFileSync(configFile, 'utf8');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('perm'), { code: 'EPERM' });
    });
    const result = await configEdit(
      root,
      { path: 'local.channel', edit: { set: 'C9' }, live: true },
      { ...deps, sleep: () => Promise.resolve() },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(
      /Could not replace .*\(EPERM\); nothing changed/,
    );
    expect(fs.readFileSync(configFile, 'utf8')).toBe(before);
    expect(temps()).toEqual([]);
  });

  it('names the config file, not its temp copy, in validation errors', async () => {
    const result = await edit({ path: 'instance.baseDir', edit: { set: 3 } });
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).not.toMatch(/\.tmp/);
  });

  it('removes a temp file a crashed edit left behind', async () => {
    const stale = path.join(cfgDir, 'config.json.4242.tmp');
    fs.writeFileSync(stale, '{}');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    await edit({ path: 'local.channel', edit: { set: 'C9' } });
    expect(fs.existsSync(stale)).toBe(false);
  });

  it('refuses when the file changed while the edit ran', async () => {
    const result = await configEdit(
      root,
      { path: 'local.channel', edit: { set: 'C9' }, live: true },
      {
        ...deps,
        loadPlugin: async (r) => {
          fs.writeFileSync(
            configFile,
            JSON.stringify({
              instance: { name: 't', baseDir: root },
              local: { channel: 'X' },
            }),
          );
          return pluginWithSchema(r);
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/changed while this edit ran/);
    expect(read()).toMatchObject({ local: { channel: 'X' } });
  });

  it('writes nothing, not even a backup, for an edit that changes nothing', async () => {
    const result = await edit({
      path: 'local.channel',
      edit: { set: 'C0' },
      live: true,
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.lines.at(-1)).toBe('unchanged: nothing written');
    expect(fs.readdirSync(cfgDir)).toEqual(['config.json']);
  });
});
