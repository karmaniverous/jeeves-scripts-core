import { fileURLToPath } from 'node:url';

import {
  CONFIG_PATH_ENV,
  configCheck,
  resetConfig,
} from '@karmaniverous/jeeves-scripts-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import plugin from '../../jeeves-scripts.plugin.js';
import sayHello from './say-hello.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const saved = process.env[CONFIG_PATH_ENV];

beforeEach(() => {
  process.env[CONFIG_PATH_ENV] = fileURLToPath(
    new URL('../../config.sample.json', import.meta.url),
  );
  resetConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
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

  it('ships a sample config that passes config check', () => {
    expect(configCheck({ root })).toMatchObject({ ok: true, errors: [] });
  });
});
