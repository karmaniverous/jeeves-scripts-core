import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import type { JobManifest } from '../runnables/manifest.js';
import { definePlugin, override, type Plugin } from '../runnables/plugin.js';
import type { RegistryEntry } from '../runnables/registry.js';
import { doctorReport } from './doctor.js';
import { buildProgram } from './index.js';
import { coreVersion } from './package-info.js';

const job = (id: string, domain: string) =>
  defineRunnable({ id, domain, description: 'A job.', run: () => undefined });

const registry: RegistryEntry[] = [
  {
    id: 'email-poll',
    domain: 'email',
    module: 'email/poll',
    load: () => Promise.resolve({ default: job('email-poll', 'email') }),
  },
];

const fields = {
  name: 'Poll',
  description: 'Poll mail.',
  schedule: { freq: 'minutely', interval: 13, timezone: 'UTC' },
  overlap_policy: 'skip',
  timeout_seconds: 300,
  enabled: true,
};
const coreManifests: JobManifest[] = [
  { id: 'email-poll', domain: 'email', ...fields, prerequisite: null },
];

let root: string;
const saved = process.env[CONFIG_PATH_ENV];

const writeConfig = (config: unknown) => {
  fs.writeFileSync(
    path.join(root, 'jeeves-scripts.json'),
    JSON.stringify(config),
  );
};

const options = (plugin?: Plugin | Error) => ({
  version: '0.2.0',
  nodeVersion: '24.22.2',
  registry,
  coreManifests,
  loadPlugin: () =>
    plugin instanceof Error ? Promise.reject(plugin) : Promise.resolve(plugin),
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-doctor-'));
  Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  resetConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('doctorReport', () => {
  it('reports version, config, plugin, prerequisites and override drift', async () => {
    writeConfig({ instance: { name: 't', baseDir: root } });
    fs.mkdirSync(path.join(root, 'jobs'));
    fs.writeFileSync(
      path.join(root, 'jobs', 'local.json'),
      JSON.stringify({
        'acme-report': { ...fields, enabled: false, prerequisite: 'A token.' },
      }),
    );
    const plugin = definePlugin({
      jobs: [job('acme-report', 'acme')],
      overrides: [
        override({
          job: 'email-poll',
          issue: 'karmaniverous/jeeves-scripts-core#1',
          writtenFor: '0.1.0',
          run: () => undefined,
        }),
      ],
    });

    const lines = await doctorReport(root, options(plugin));

    expect(lines).toEqual([
      'core: @karmaniverous/jeeves-scripts-core 0.2.0',
      'node: 24.22.2 (requires >=24.22.2): OK',
      `config: ${path.join(root, 'jeeves-scripts.json')} (from legacy repo file): OK`,
      'plugin: jeeves-scripts.plugin.ts: 1 runnables, 1 overrides',
      'manifests: 2 (prerequisites: 1 met, 0 not met, 1 manual)',
      '  email-poll: enabled; prerequisite: met',
      '  acme-report: disabled; prerequisite: manual: A token.',
      'overrides: 1 (1 written for another core version)',
      '  email-poll: written for 0.1.0, installed 0.2.0: DRIFT (recheck karmaniverous/jeeves-scripts-core#1)',
    ]);
  });

  it('reports the Node version it is given against the floor (#75)', async () => {
    writeConfig({ instance: { name: 't' } });

    const lines = await doctorReport(root, {
      ...options(),
      nodeVersion: '24.18.0',
    });

    expect(lines[1]).toMatch(
      /^node: 24\.18\.0: FAILED: requires >=24\.22\.2; /,
    );
  });

  it("runs each manifest runnable's prerequisite check for its state (R29)", async () => {
    writeConfig({ instance: { name: 't', baseDir: root } });
    fs.mkdirSync(path.join(root, 'jobs'));
    const manifest = { ...fields, prerequisite: null };
    fs.writeFileSync(
      path.join(root, 'jobs', 'local.json'),
      JSON.stringify({
        'acme-ready': manifest,
        'acme-blocked': { ...manifest, args: ['--site', 'x'] },
        'acme-broken': manifest,
      }),
    );
    const seen: (readonly string[])[] = [];
    const checked = (
      id: string,
      prerequisite: (ctx: { args: readonly string[] }) => true | string,
    ) =>
      defineRunnable({
        id,
        domain: 'acme',
        prerequisite: (ctx) => {
          seen.push(ctx.args);
          return prerequisite(ctx);
        },
        run: () => undefined,
      });
    const plugin = definePlugin({
      jobs: [
        checked('acme-ready', () => true),
        checked('acme-blocked', () => 'no acme token'),
        checked('acme-broken', () => {
          throw new Error('boom');
        }),
      ],
    });

    const lines = await doctorReport(root, options(plugin));

    expect(lines).toContain(
      'manifests: 4 (prerequisites: 2 met, 1 not met, 0 manual)',
    );
    expect(lines).toContain('  acme-ready: enabled; prerequisite: met');
    expect(lines).toContain(
      '  acme-blocked: enabled; prerequisite: not met: no acme token',
    );
    expect(lines).toContain(
      '  acme-broken: enabled; prerequisite: unknown (check threw: boom)',
    );
    expect(seen).toContainEqual(['--site', 'x']);
  });

  it('reports a doctorCheck once the prerequisite is met (a run that would fail)', async () => {
    writeConfig({ instance: { name: 't', baseDir: root } });
    fs.mkdirSync(path.join(root, 'jobs'));
    const manifest = { ...fields, prerequisite: null };
    fs.writeFileSync(
      path.join(root, 'jobs', 'local.json'),
      JSON.stringify({
        'acme-tools': manifest,
        'acme-skipped': manifest,
        'acme-only-check': manifest,
      }),
    );
    const doctorCheck = vi.fn(() => 'rsync not found on PATH');
    const plugin = definePlugin({
      jobs: [
        defineRunnable({
          id: 'acme-tools',
          domain: 'acme',
          prerequisite: () => true,
          doctorCheck,
          run: () => undefined,
        }),
        defineRunnable({
          id: 'acme-skipped',
          domain: 'acme',
          prerequisite: () => 'nothing configured',
          doctorCheck,
          run: () => undefined,
        }),
        defineRunnable({
          id: 'acme-only-check',
          domain: 'acme',
          doctorCheck: () => true,
          run: () => undefined,
        }),
      ],
    });

    const lines = await doctorReport(root, options(plugin));

    expect(lines).toContain(
      '  acme-tools: enabled; prerequisite: not met: rsync not found on PATH',
    );
    expect(lines).toContain(
      '  acme-skipped: enabled; prerequisite: not met: nothing configured',
    );
    expect(lines).toContain('  acme-only-check: enabled; prerequisite: met');
    expect(doctorCheck).toHaveBeenCalledTimes(1);
  });

  it('shows an override written for the installed version without drift', async () => {
    writeConfig({ instance: { name: 't', baseDir: root } });
    const plugin = definePlugin({
      overrides: [
        override({
          job: 'email-poll',
          issue: 'x/y#2',
          writtenFor: '0.2.0',
          run: () => undefined,
        }),
      ],
    });

    const lines = await doctorReport(root, options(plugin));

    expect(lines).toContain(
      'overrides: 1 (0 written for another core version)',
    );
    expect(lines).toContain('  email-poll: written for 0.2.0');
  });

  it('reports problems as lines and never throws', async () => {
    writeConfig({ instance: { name: 't' } });

    const lines = await doctorReport(root, options(new Error('boom')));

    expect(lines[2]).toMatch(/: FAILED$/);
    expect(lines).toContain('plugin: FAILED');
    expect(lines).toContain('  boom');
    expect(lines).toContain('overrides: none');
    expect(lines.some((l) => l.startsWith('manifests:'))).toBe(false);
  });

  it('reports an invalid manifest or delta, and no plugin', async () => {
    writeConfig({
      instance: { name: 't', baseDir: root },
      jobs: { 'nope-job': { enabled: false } },
    });

    const lines = await doctorReport(root, options());

    expect(lines).toContain('plugin: none (no jeeves-scripts.plugin.ts)');
    expect(lines).toContain('manifests: FAILED');
    expect(lines.join('\n')).toMatch(/nope-job/);
  });

  it('defaults to the running core version', async () => {
    writeConfig({ instance: { name: 't', baseDir: root } });
    const { version: _v, ...rest } = options();
    const lines = await doctorReport(root, rest);
    expect(lines[0]).toBe(
      `core: @karmaniverous/jeeves-scripts-core ${coreVersion()}`,
    );
  });
});

describe('doctor command', () => {
  it('prints the report and exits 0 even when the config is invalid', async () => {
    writeConfig({ instance: { name: 't' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.exitCode = undefined;

    await buildProgram({ root }).parseAsync(['doctor'], { from: 'user' });

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^core: @karmaniverous\/jeeves-scripts-core /),
    );
    expect(process.exitCode).toBeUndefined();
  });

  describe('Node floor (#75)', () => {
    const running = Object.getOwnPropertyDescriptor(process.versions, 'node');
    const runAs = async (node: string) => {
      Object.defineProperty(process.versions, 'node', {
        ...running,
        value: node,
      });
      // An invalid config keeps the run short (no manifests are loaded);
      // only the Node floor may set the exit code.
      writeConfig({ instance: { name: 't' } });
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      process.exitCode = undefined;
      try {
        await buildProgram({ root }).parseAsync(['doctor'], { from: 'user' });
      } finally {
        if (running) Object.defineProperty(process.versions, 'node', running);
      }
      const code = process.exitCode;
      process.exitCode = undefined;
      return { code, lines: log.mock.calls.map(([l]) => String(l)) };
    };

    it('fails below 24.22.2, naming the running and required versions', async () => {
      const { code, lines } = await runAs('24.18.0');
      expect(code).toBe(1);
      expect(lines).toContain(
        'node: 24.18.0: FAILED: requires >=24.22.2; Node 24.16-24.18 have a SQLite WAL checkpoint bug (the WAL grows without bound). Upgrade Node.',
      );
    });

    it('passes at the floor (above it: node-version.test.ts)', async () => {
      const { code, lines } = await runAs('24.22.2');
      expect(code).toBeUndefined();
      expect(lines).toContain('node: 24.22.2 (requires >=24.22.2): OK');
    });
  });
});
