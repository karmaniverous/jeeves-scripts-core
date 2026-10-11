import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { definePlugin, resetLocalConfig } from '../jobs/plugin.js';
import { instanceConfigCheck } from './config-check.js';
import { loadPlugin, PLUGIN_FILE } from './load-plugin.js';

let root: string;
const saved = process.env[CONFIG_PATH_ENV];

const writeConfig = (config: Record<string, unknown>) => {
  fs.writeFileSync(
    path.join(root, 'jeeves-scripts.json'),
    JSON.stringify({ instance: { name: 't', baseDir: root }, ...config }),
  );
};

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

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-config-check-'));
  fs.writeFileSync(path.join(root, PLUGIN_FILE), '');
  Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  resetConfig();
});

afterEach(() => {
  resetLocalConfig();
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('instanceConfigCheck', () => {
  it("passes when the plugin's configSchema accepts local", async () => {
    writeConfig({ local: { channel: 'C000EXAMPLE1' } });
    const result = await instanceConfigCheck(root, undefined, {
      loadPlugin: pluginWithSchema,
    });
    expect(result).toEqual({
      ok: true,
      configPath: path.join(root, 'jeeves-scripts.json'),
      errors: [],
    });
  });

  it('reports a local block the plugin rejects as a config error', async () => {
    writeConfig({ local: { channel: 7 } });
    const result = await instanceConfigCheck(root, undefined, {
      loadPlugin: pluginWithSchema,
    });
    expect(result.ok).toBe(false);
    expect(result.configPath).toBe(path.join(root, 'jeeves-scripts.json'));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(
      /^Invalid local block in .*jeeves-scripts\.json[\s\S]*channel/,
    );
  });

  it('reports a plugin that fails to load', async () => {
    writeConfig({});
    const result = await instanceConfigCheck(root, undefined, {
      loadPlugin: () => Promise.reject(new Error('plugin broke')),
    });
    expect(result).toMatchObject({ ok: false, errors: ['plugin broke'] });
  });

  it('does not load the plugin when the core checks fail', async () => {
    fs.writeFileSync(path.join(root, 'jeeves-scripts.json'), '{}');
    const load = vi.fn(pluginWithSchema);
    const result = await instanceConfigCheck(root, undefined, {
      loadPlugin: load,
    });
    expect(result.ok).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('pins JEEVES_SCRIPTS_CONFIG to the checked file before loading the plugin', async () => {
    writeConfig({});
    let seen: string | undefined;
    await instanceConfigCheck(root, undefined, {
      loadPlugin: () => {
        seen = process.env[CONFIG_PATH_ENV];
        return Promise.resolve(undefined);
      },
    });
    expect(seen).toBe(path.join(root, 'jeeves-scripts.json'));
  });

  it('checks an explicit --config file', async () => {
    const other = path.join(root, 'other.json');
    fs.writeFileSync(
      other,
      JSON.stringify({
        instance: { name: 't', baseDir: root },
        local: { channel: 'C000EXAMPLE1' },
      }),
    );
    const result = await instanceConfigCheck(root, other, {
      loadPlugin: pluginWithSchema,
    });
    expect(result).toMatchObject({ ok: true, configPath: other });
  });
});
