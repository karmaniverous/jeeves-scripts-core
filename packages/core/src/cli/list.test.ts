import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { defineJob } from '../jobs/define-job.js';
import type { JobManifest } from '../jobs/manifest.js';
import { definePlugin, override, type Plugin } from '../jobs/plugin.js';
import type { RegistryEntry } from '../jobs/registry.js';
import { formatList, globToRegExp, listRunnables } from './list.js';

const job = (id: string, domain: string, description?: string) =>
  defineJob({
    id,
    domain,
    ...(description ? { description } : {}),
    run: () => undefined,
  });

const entry = (
  id: string,
  domain: string,
  description?: string,
): RegistryEntry => ({
  id,
  domain,
  module: `${domain}/${id}`,
  load: () => Promise.resolve({ default: job(id, domain, description) }),
});

const registry = [
  entry('email-poll', 'email'),
  entry('email-inventory', 'email', 'Count threads.'),
  entry('x-post', 'x', 'Publish the queue.'),
];

const fields = {
  name: 'Poll',
  description: 'Poll mail.',
  schedule: { freq: 'minutely', interval: 13 },
  overlap_policy: 'skip',
  timeout_seconds: 300,
  enabled: true,
  prerequisite: null,
};
const coreManifests: JobManifest[] = [
  { id: 'email-poll', domain: 'email', ...fields },
];

let root: string;
const saved = process.env[CONFIG_PATH_ENV];

const setup = (jobs: Record<string, unknown> = {}) => {
  fs.writeFileSync(
    path.join(root, 'jeeves-scripts.json'),
    JSON.stringify({ instance: { name: 't', baseDir: root }, jobs }),
  );
};

const options = (plugin?: Plugin) => ({
  registry,
  coreManifests,
  loadPlugin: () => Promise.resolve(plugin),
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-list-'));
  Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  resetConfig();
});

afterEach(() => {
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it.each([
    ['*', 'email-poll', true],
    ['email-*', 'email-poll', true],
    ['email-*', 'x-post', false],
    ['x-p?st', 'x-post', true],
    ['[ex]*-po*', 'x-post', true],
    ['[!e]*', 'email-poll', false],
    ['email-poll', 'email-poll', true],
    ['email.poll', 'email-poll', false],
  ])('%s matches %s: %s', (glob, id, expected) => {
    expect(globToRegExp(glob).test(id)).toBe(expected);
  });
});

describe('listRunnables', () => {
  it('lists every runnable sorted by id, with effective manifests and descriptions', async () => {
    setup({ 'email-poll': { enabled: false } });
    fs.mkdirSync(path.join(root, 'jobs'));
    const { name: _n, ...rest } = fields;
    fs.writeFileSync(
      path.join(root, 'jobs', 'acme.json'),
      JSON.stringify({
        'acme-report': { ...rest, name: 'Report', description: 'Report.' },
        'x-post': {
          ...rest,
          name: 'Post',
          description: 'Post hourly.',
          enabled: false,
        },
      }),
    );
    const entries = await listRunnables(
      root,
      '*',
      options(
        definePlugin({
          jobs: [
            job('acme-report', 'acme'),
            job('acme-adhoc', 'acme', 'Ad hoc.'),
          ],
          overrides: [
            override({
              job: 'email-inventory',
              issue: 'karmaniverous/jeeves-scripts-core#5',
              writtenFor: '0.1.0',
              run: () => undefined,
            }),
          ],
        }),
      ),
    );
    expect(
      entries.map((e) => [e.id, e.source, e.domain, e.enabled, e.description]),
    ).toEqual([
      ['acme-adhoc', 'instance', 'acme', null, 'Ad hoc.'],
      ['acme-report', 'instance', 'acme', true, 'Report.'],
      ['email-inventory', 'override', 'email', null, 'Count threads.'],
      ['email-poll', 'core', 'email', false, 'Poll mail.'],
      ['x-post', 'core', 'x', false, 'Post hourly.'],
    ]);
    expect(entries[3]?.schedule).toEqual({ freq: 'minutely', interval: 13 });
    expect(entries[3]?.manifest).toMatchObject({
      id: 'email-poll',
      enabled: false,
    });
    expect(entries[0]?.manifest).toBeNull();
    expect(entries[0]?.schedule).toBeNull();
    expect(process.env[CONFIG_PATH_ENV]).toBe(
      path.join(root, 'jeeves-scripts.json'),
    );
  });

  it('filters by glob', async () => {
    setup();
    const entries = await listRunnables(root, 'email-*', options());
    expect(entries.map((e) => e.id)).toEqual(['email-inventory', 'email-poll']);
  });

  it('fails on an invalid delta', async () => {
    setup({ 'acme-gone': { enabled: true } });
    await expect(listRunnables(root, '*', options())).rejects.toThrow(
      /acme-gone/,
    );
  });
});

describe('formatList', () => {
  it('aligns columns under a header, leaving manifest-less cells blank', () => {
    expect(
      formatList([
        {
          id: 'email-poll',
          source: 'core',
          domain: 'email',
          schedule: { freq: 'hourly' },
          enabled: true,
          description: 'Poll mail.',
          manifest: null,
        },
        {
          id: 'x-post',
          source: 'override',
          domain: 'x',
          schedule: null,
          enabled: null,
          description: 'Publish.',
          manifest: null,
        },
      ]),
    ).toEqual([
      'id          source    schedule           enabled  description',
      'email-poll  core      {"freq":"hourly"}  true     Poll mail.',
      'x-post      override                              Publish.',
    ]);
  });
});
