/**
 * Job config through the CLI (Decisions 79, 81): `config check`, `list`,
 * `doctor` and `run` resolve a job's config the same way, and fail the same
 * way, naming the job id, when it is invalid.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { definePlugin } from '../runnables/plugin.js';
import { instanceConfigCheck } from './config-check.js';
import { doctorReport } from './doctor.js';
import { listRunnables } from './list.js';
import { runJob } from './run.js';

let root: string;
const saved = process.env[CONFIG_PATH_ENV];
const seen: { jobId: string; config: unknown; by: string }[] = [];

const configSchema = z.object({
  channel: z.string(),
  recipients: z.array(z.string()).default([]),
});

const brief = defineRunnable({
  id: 'acme-brief',
  domain: 'acme',
  configSchema,
  prerequisite: ({ jobId, config }) => {
    seen.push({ jobId, config, by: 'prerequisite' });
    return true;
  },
  run: ({ jobId, config }) => {
    seen.push({ jobId, config, by: 'run' });
  },
});

const options = {
  registry: [],
  coreManifests: [],
  loadPlugin: () => Promise.resolve(definePlugin({ jobs: [brief] })),
};

const setup = (config: Record<string, unknown>) => {
  fs.writeFileSync(
    path.join(root, 'jeeves-scripts.json'),
    JSON.stringify({
      instance: { name: 't', baseDir: root },
      jobs: { 'acme-brief': { config } },
    }),
  );
  fs.mkdirSync(path.join(root, 'jobs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'jobs', 'acme.json'),
    JSON.stringify({
      'acme-brief': {
        name: 'Brief',
        description: 'Brief.',
        schedule: '@daily',
        overlap_policy: 'skip',
        enabled: true,
        prerequisite: null,
      },
    }),
  );
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-job-config-'));
  Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  resetConfig();
  seen.length = 0;
});

afterEach(() => {
  resetConfig();
  if (saved === undefined) Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
  else process.env[CONFIG_PATH_ENV] = saved;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('a valid job config', () => {
  it('passes config check and list, and reaches doctor and run as ctx.config', async () => {
    setup({ channel: 'C000EXAMPLE1' });
    const parsed = { channel: 'C000EXAMPLE1', recipients: [] };
    expect((await instanceConfigCheck(root, undefined, options)).ok).toBe(true);
    expect((await listRunnables(root, '*', options)).map((e) => e.id)).toEqual([
      'acme-brief',
    ]);
    const lines = await doctorReport(root, { ...options, version: '0.4.0' });
    expect(lines).toContain('  acme-brief: enabled; prerequisite: met');
    expect(await runJob(root, 'acme-brief', [], options)).toBe(0);
    expect(seen).toEqual([
      { jobId: 'acme-brief', config: parsed, by: 'prerequisite' },
      { jobId: 'acme-brief', config: parsed, by: 'prerequisite' },
      { jobId: 'acme-brief', config: parsed, by: 'run' },
    ]);
  });
});

describe('an invalid job config', () => {
  it('fails config check, list, doctor and run with one message naming the job id', async () => {
    setup({ recipients: 'everyone' });
    const result = await instanceConfigCheck(root, undefined, options);
    expect(result.ok).toBe(false);
    const [message] = result.errors;
    expect(message).toMatch(
      /^Invalid job config:\n- job "acme-brief": invalid config \(jobs\.acme-brief\.config\): /,
    );
    expect(message).toMatch(/channel/);
    expect(message).toMatch(/recipients/);
    await expect(listRunnables(root, '*', options)).rejects.toThrow(message);
    const lines = await doctorReport(root, { ...options, version: '0.4.0' });
    expect(lines).toContain('manifests: FAILED');
    expect(lines.join('\n')).toContain(
      message
        ?.split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runJob(root, 'acme-brief', [], options)).rejects.toThrow(
      message,
    );
    log.mockRestore();
    expect(seen).toEqual([]);
  });
});
