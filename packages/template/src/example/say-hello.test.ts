import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CONFIG_PATH_ENV,
  resetConfig,
} from '@karmaniverous/jeeves-scripts-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import plugin from '../../jeeves-scripts.plugin.js';
import sayHello from './say-hello.js';

const saved = process.env[CONFIG_PATH_ENV];
let dir: string;

// The instance's real config lives outside the repo; the test uses its own.
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'say-hello-'));
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(
    config,
    JSON.stringify({ instance: { name: 'example', baseDir: dir } }),
  );
  process.env[CONFIG_PATH_ENV] = config;
  resetConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('example-say-hello', () => {
  it('greets the name it is given, from this instance', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await sayHello.run({ args: ['Jane'] });

    expect(log).toHaveBeenCalledWith('Hello, Jane, from example!');
  });

  it('greets the world by default', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await sayHello.run({ args: [] });

    expect(log).toHaveBeenCalledWith('Hello, world, from example!');
  });

  it('is registered by the plugin', () => {
    expect(plugin.jobs).toContain(sayHello);
  });
});
