import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defineJob } from './define-job.js';
import type { JobManifest } from './manifest.js';
import { definePlugin, override } from './plugin.js';
import type { RegistryEntry } from './registry.js';
import {
  buildRunnables,
  readInstanceManifests,
  registeredManifests,
} from './runnables.js';

const job = (id: string, domain: string, description?: string) =>
  defineJob({
    id,
    domain,
    ...(description ? { description } : {}),
    run: () => undefined,
  });

const entry = (id: string, domain: string): RegistryEntry => ({
  id,
  domain,
  module: `${domain}/${id}`,
  load: () => Promise.resolve({ default: job(id, domain, `core ${id}`) }),
});

const registry = [
  entry('email-poll', 'email'),
  entry('x-post', 'x'),
  entry('slack-poll', 'slack'),
];
const domains = ['email', 'slack', 'x', 'convert'];

const ov = (id: string) =>
  override({
    job: id,
    issue: 'karmaniverous/jeeves-scripts-core#9',
    writtenFor: '0.1.0',
    run: () => undefined,
  });

const manifest = (
  id: string,
  domain: string,
  extra: Partial<JobManifest> = {},
): JobManifest => ({
  id,
  domain,
  name: id,
  description: `manifest ${id}`,
  schedule: { freq: 'hourly', timezone: 'UTC' },
  overlap_policy: 'skip',
  timeout_seconds: 60,
  enabled: true,
  prerequisite: null,
  ...extra,
});

describe('buildRunnables', () => {
  it('lists core runnables alone, sorted by id, when there is no plugin', () => {
    const runnables = buildRunnables({ registry, domains });
    expect(runnables.map((r) => [r.id, r.source])).toEqual([
      ['email-poll', 'core'],
      ['slack-poll', 'core'],
      ['x-post', 'core'],
    ]);
  });

  it('adds plugin runnables and puts overrides in place of core runnables', async () => {
    const acme = job('acme-report', 'acme');
    const runnables = buildRunnables({
      registry,
      domains,
      plugin: definePlugin({ jobs: [acme], overrides: [ov('x-post')] }),
    });
    expect(runnables.map((r) => [r.id, r.domain, r.source])).toEqual([
      ['acme-report', 'acme', 'instance'],
      ['email-poll', 'email', 'core'],
      ['slack-poll', 'slack', 'core'],
      ['x-post', 'x', 'override'],
    ]);
    expect(await runnables[0]?.load()).toBe(acme);
    const overridden = await runnables[3]?.load();
    expect(overridden).toMatchObject({ id: 'x-post', domain: 'x' });
    expect(runnables[3]?.core?.id).toBe('x-post');
  });

  it('fails plugin load listing every rule broken, naming ids and domains', () => {
    expect(() =>
      buildRunnables({
        registry,
        domains,
        plugin: definePlugin({
          jobs: [
            job('email-poll', 'email'),
            job('convert-thing', 'convert'),
            job('acme-a', 'acme'),
            job('acme-a', 'acme'),
          ],
          overrides: [ov('acme-b'), ov('slack-poll'), ov('slack-poll')],
        }),
      }),
    ).toThrow(
      [
        'Invalid jeeves-scripts.plugin.ts:',
        '- runnable "email-poll" reuses a core id; declare an override of it instead',
        '- runnable "convert-thing": domain "convert" is a core domain; instance domains never reuse one',
        '- runnable "acme-a" is registered twice',
        '- override "acme-b" names no core runnable',
        '- override "slack-poll" is declared twice',
      ].join('\n'),
    );
  });
});

describe('readInstanceManifests', () => {
  it('reads {root}/jobs/*.json in core format, or nothing without jobs/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-manifests-'));
    expect(readInstanceManifests(root)).toEqual([]);
    fs.mkdirSync(path.join(root, 'jobs'));
    const { id, domain, ...fields } = manifest('acme-report', 'acme');
    fs.writeFileSync(
      path.join(root, 'jobs', 'acme.json'),
      JSON.stringify({ [id]: fields }),
    );
    expect(readInstanceManifests(root)).toEqual([{ id, domain, ...fields }]);
    fs.writeFileSync(
      path.join(root, 'jobs', 'old.json'),
      JSON.stringify([{ id: 'acme-x', script: 'src/acme/x.ts' }]),
    );
    expect(() => readInstanceManifests(root)).toThrow(/jobs[\\/]old\.json/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('registeredManifests', () => {
  const runnables = buildRunnables({
    registry,
    domains,
    plugin: definePlugin({ jobs: [job('acme-report', 'acme')] }),
  });
  const coreManifests = [manifest('email-poll', 'email')];

  it('applies deltas to core and instance manifests, including one for a manifest-less core runnable (Decision 50)', () => {
    const effective = registeredManifests({
      runnables,
      coreManifests,
      instanceManifests: [
        manifest('acme-report', 'acme'),
        manifest('x-post', 'social', { enabled: false }),
      ],
      deltas: {
        'email-poll': { enabled: false },
        'x-post': { args: ['--live'] },
      },
    });
    expect([...effective.keys()]).toEqual([
      'email-poll',
      'acme-report',
      'x-post',
    ]);
    expect(effective.get('email-poll')?.enabled).toBe(false);
    expect(effective.get('x-post')).toMatchObject({
      domain: 'x',
      args: ['--live'],
      enabled: false,
    });
    expect(effective.has('slack-poll')).toBe(false);
  });

  it('rejects instance manifests for unregistered ids or ids with a core manifest', () => {
    expect(() =>
      registeredManifests({
        runnables,
        coreManifests,
        instanceManifests: [
          manifest('acme-gone', 'acme'),
          manifest('email-poll', 'email'),
        ],
        deltas: {},
      }),
    ).toThrow(
      [
        'Invalid instance manifests:',
        '- jobs/acme.json: "acme-gone" is not a registered runnable',
        '- jobs/email.json: "email-poll" has a core manifest; change it with jobs.email-poll in jeeves-scripts.json',
      ].join('\n'),
    );
  });

  it('rejects a delta naming an unregistered id', () => {
    expect(() =>
      registeredManifests({
        runnables,
        coreManifests,
        instanceManifests: [],
        deltas: { 'acme-gone': { enabled: true } },
      }),
    ).toThrow(/acme-gone/);
  });

  it('requires a description of an instance runnable that has no manifest (Decision 57)', () => {
    const plugin = definePlugin({
      jobs: [job('acme-bare', 'acme'), job('acme-told', 'acme', 'Tells.')],
    });
    const input = {
      runnables: buildRunnables({ registry, domains, plugin }),
      coreManifests,
      deltas: {},
    };
    expect(() =>
      registeredManifests({ ...input, instanceManifests: [] }),
    ).toThrow(
      [
        'Invalid jeeves-scripts.plugin.ts:',
        '- runnable "acme-bare" has no manifest and no description; add description to its defineJob',
      ].join('\n'),
    );
    expect(
      registeredManifests({
        ...input,
        instanceManifests: [manifest('acme-bare', 'acme')],
      }).has('acme-bare'),
    ).toBe(true);
  });
});

describe('overrides', () => {
  const labelled: RegistryEntry = {
    id: 'email-poll',
    domain: 'email',
    module: 'email/poll',
    load: () =>
      Promise.resolve({
        default: defineJob({
          id: 'email-poll',
          domain: 'email',
          description: 'Poll mail.',
          name: 'email/poll',
          crashDir: () => '/crash',
          run: () => undefined,
        }),
      }),
  };

  it("keep the core runnable's crash label, crash directory and description (Decision 57)", async () => {
    const [runnable] = buildRunnables({
      registry: [labelled],
      domains,
      plugin: definePlugin({ overrides: [ov('email-poll')] }),
    });
    const job = await runnable?.load();
    expect(job).toMatchObject({
      id: 'email-poll',
      name: 'email/poll',
      description: 'Poll mail.',
    });
    expect(job?.crashDir?.()).toBe('/crash');
  });

  it('run under their id when the core module fails to load', async () => {
    const [runnable] = buildRunnables({
      registry: [
        { ...labelled, load: () => Promise.reject(new Error('broken')) },
      ],
      domains,
      plugin: definePlugin({ overrides: [ov('email-poll')] }),
    });
    const job = await runnable?.load();
    expect(job?.id).toBe('email-poll');
    expect(job?.name).toBeUndefined();
    expect(job?.crashDir).toBeUndefined();
  });
});
