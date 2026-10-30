import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { isJobModule } from '../runnables/define-runnable.js';
import { localConfig, resetLocalConfig } from '../runnables/plugin.js';
import { loadPlugin, PLUGIN_FILE } from './load-plugin.js';

const runnablesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../runnables',
);
const url = (file: string) => pathToFileURL(path.join(runnablesDir, file)).href;

let root: string;
const saved = process.env[CONFIG_PATH_ENV];

const writeConfig = (local?: unknown) => {
  fs.writeFileSync(
    path.join(root, 'jeeves-scripts.json'),
    JSON.stringify({ instance: { name: 't', baseDir: root }, local }),
  );
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-plugin-'));
  // Instance repos are ES modules (the template's package.json).
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  process.env[CONFIG_PATH_ENV] = path.join(root, 'jeeves-scripts.json');
  resetConfig();
});

afterEach(() => {
  resetLocalConfig();
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('loadPlugin', () => {
  it('returns undefined when the instance has no plugin file', async () => {
    expect(await loadPlugin(root)).toBeUndefined();
  });

  it('imports a TypeScript plugin in process with tsx and parses local with its configSchema', async () => {
    writeConfig({ channel: 'C1' });
    // TypeScript syntax (types, an interface) proves tsx compiled it.
    fs.writeFileSync(
      path.join(root, PLUGIN_FILE),
      `import { defineRunnable } from '${url('define-runnable.ts')}';
import { definePlugin } from '${url('plugin.ts')}';

interface Local { channel: string; seen: boolean }

const configSchema = {
  safeParse: (value: unknown) => ({
    success: true as const,
    data: { ...(value as object), seen: true } satisfies Partial<Local>,
  }),
};

export default definePlugin({
  jobs: [defineRunnable({ id: 'acme-report', domain: 'acme', run: (): void => undefined })],
  configSchema,
});
`,
    );
    const plugin = await loadPlugin(root);
    expect(plugin?.jobs?.map((j) => j.id)).toEqual(['acme-report']);
    expect(isJobModule(plugin?.jobs?.[0])).toBe(true);
    expect(localConfig()).toEqual({ channel: 'C1', seen: true });
  }, 60_000);

  it('rejects a file that does not default-export definePlugin(...)', async () => {
    fs.writeFileSync(
      path.join(root, PLUGIN_FILE),
      'export default { jobs: [] };\n',
    );
    await expect(loadPlugin(root)).rejects.toThrow(
      `${PLUGIN_FILE} must default-export definePlugin(...).`,
    );
  }, 60_000);

  it('fails when configSchema rejects the local block, naming the config file', async () => {
    writeConfig();
    const fake = {
      safeParse: () => ({
        success: false,
        error: {
          issues: [{ code: 'custom', message: 'local is required', path: [] }],
        },
      }),
    };
    const { definePlugin } = await import('../runnables/plugin.js');
    fs.writeFileSync(path.join(root, PLUGIN_FILE), '');
    await expect(
      loadPlugin(root, {
        importTs: () =>
          Promise.resolve({
            default: definePlugin({ configSchema: fake as never }),
          }),
      }),
    ).rejects.toThrow(/Invalid local block in .*jeeves-scripts\.json/);
  });
});
