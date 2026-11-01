import path from 'node:path';

import { argFlag, argValue } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV, getConfigRoot } from '../config/loader.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { definePlugin, override, type Plugin } from '../runnables/plugin.js';
import type { RegistryEntry } from '../runnables/registry.js';
import { registerInstance, resolveRunnable, runJob } from './run.js';

const root = path.resolve('/instance');
const ran: {
  id: string;
  by: string;
  args: readonly string[];
  argv: string[];
}[] = [];

const job = (id: string, domain: string, by = 'core') =>
  defineRunnable({
    id,
    domain,
    run: ({ args }) => {
      ran.push({ id, by, args, argv: process.argv.slice(1) });
    },
  });

const entry = (id: string, domain: string): RegistryEntry => ({
  id,
  domain,
  module: `${domain}/${id}`,
  load: () => Promise.resolve({ default: job(id, domain) }),
});

/** A test registry: two core runnables. */
const registry: RegistryEntry[] = [
  entry('email-poll', 'email'),
  entry('slack-poll', 'slack'),
];

const withPlugin = (plugin?: Plugin) => ({
  registry,
  loadPlugin: () => Promise.resolve(plugin),
});

const saved = process.env[CONFIG_PATH_ENV];

beforeEach(() => {
  ran.length = 0;
  Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
});

afterEach(() => {
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
});

describe('registerInstance', () => {
  it('registers the instance root with the loader, not the env var, before loading the plugin (#57)', async () => {
    let seen: [string | undefined, string | undefined] = [undefined, undefined];
    await registerInstance(root, {
      registry,
      loadPlugin: () => {
        seen = [getConfigRoot(), process.env[CONFIG_PATH_ENV]];
        return Promise.resolve(undefined);
      },
    });
    expect(seen).toEqual([root, undefined]);
  });

  it('keeps an explicit JEEVES_SCRIPTS_CONFIG', async () => {
    process.env[CONFIG_PATH_ENV] = '/elsewhere.json';
    await registerInstance(root, withPlugin());
    expect(process.env[CONFIG_PATH_ENV]).toBe('/elsewhere.json');
  });

  it('registers core runnables, overrides and plugin runnables', async () => {
    const runnables = await registerInstance(
      root,
      withPlugin(
        definePlugin({
          jobs: [job('acme-report', 'acme', 'instance')],
          overrides: [
            override({
              job: 'slack-poll',
              issue: 'karmaniverous/jeeves-scripts-core#1',
              writtenFor: '0.1.0',
              run: () => undefined,
            }),
          ],
        }),
      ),
    );
    expect(runnables.map((r) => [r.id, r.source])).toEqual([
      ['acme-report', 'instance'],
      ['email-poll', 'core'],
      ['slack-poll', 'override'],
    ]);
  });
});

describe('resolveRunnable', () => {
  it('throws on an unknown id', async () => {
    const runnables = await registerInstance(root, withPlugin());
    expect(() => resolveRunnable(runnables, 'nope-job')).toThrow(
      /Unknown runnable "nope-job"/,
    );
  });
});

describe('runJob', () => {
  it('runs a core runnable in process with its args, and argv set to [node, id, ...args]', async () => {
    const code = await runJob(
      root,
      'email-poll',
      ['--dry-run', 'x'],
      withPlugin(),
    );
    expect(code).toBe(0);
    expect(ran).toEqual([
      {
        id: 'email-poll',
        by: 'core',
        args: ['--dry-run', 'x'],
        argv: ['email-poll', '--dry-run', 'x'],
      },
    ]);
  });

  it('runs a plugin runnable in process', async () => {
    await runJob(
      root,
      'acme-report',
      ['--live'],
      withPlugin(
        definePlugin({ jobs: [job('acme-report', 'acme', 'instance')] }),
      ),
    );
    expect(ran).toEqual([
      {
        id: 'acme-report',
        by: 'instance',
        args: ['--live'],
        argv: ['acme-report', '--live'],
      },
    ]);
  });

  it("runs a declared override instead of core's runnable, under core's id", async () => {
    const calls: (readonly string[])[] = [];
    await runJob(
      root,
      'email-poll',
      ['a'],
      withPlugin(
        definePlugin({
          overrides: [
            override({
              job: 'email-poll',
              issue: 'karmaniverous/jeeves-scripts-core#2',
              writtenFor: '0.1.0',
              run: ({ args }) => {
                calls.push(args);
              },
            }),
          ],
        }),
      ),
    );
    expect(calls).toEqual([['a']]);
    expect(ran).toEqual([]);
    expect(process.argv[1]).toBe('email-poll');
  });

  it('fails on an unknown id before running anything', async () => {
    await expect(runJob(root, 'acme-gone', [], withPlugin())).rejects.toThrow(
      /Unknown runnable "acme-gone"/,
    );
    expect(ran).toEqual([]);
  });

  it('fails on a registration error before running anything', async () => {
    await expect(
      runJob(
        root,
        'email-poll',
        [],
        withPlugin(definePlugin({ jobs: [job('email-poll', 'email')] })),
      ),
    ).rejects.toThrow(/reuses a core id/);
    expect(ran).toEqual([]);
  });
});

describe('runJob: declared flags (#14)', () => {
  const seen: unknown[] = [];
  const strict = defineRunnable({
    id: 'acme-strict',
    domain: 'acme',
    flags: {
      live: argFlag('--live'),
      max: argValue('--max', '5'),
    },
    run: ({ flags }) => {
      seen.push(flags);
    },
  });
  const opts = withPlugin(
    definePlugin({ jobs: [strict, job('acme-loose', 'acme', 'instance')] }),
  );

  beforeEach(() => {
    seen.length = 0;
  });

  it('parses declared flags into ctx.flags (both value forms)', async () => {
    expect(await runJob(root, 'acme-strict', ['--live', '--max=7'], opts)).toBe(
      0,
    );
    expect(await runJob(root, 'acme-strict', ['--max', '9'], opts)).toBe(0);
    expect(seen).toEqual([
      { live: true, max: '7' },
      { live: false, max: '9' },
    ]);
  });

  it.each([
    [
      ['--bogus'],
      'Unknown option --bogus for acme-strict (see run acme-strict --help)',
    ],
    [
      ['stray'],
      'Unexpected argument stray for acme-strict (see run acme-strict --help)',
    ],
    [
      ['--max'],
      '--max requires a value for acme-strict (see run acme-strict --help)',
    ],
  ])('rejects %j with exit 1 before the body runs', async (args, message) => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(await runJob(root, 'acme-strict', args, opts)).toBe(1);
      expect(error).toHaveBeenCalledWith(message);
    } finally {
      error.mockRestore();
    }
    expect(seen).toEqual([]);
  });

  it('runs an undeclared runnable with a deprecation warning when given flags', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await runJob(root, 'acme-loose', ['--anything'], opts)).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/^\[deprecated\] acme-loose declares no flags/),
      );
    } finally {
      warn.mockRestore();
    }
    expect(ran.map((r) => r.args)).toEqual([['--anything']]);
  });
});
