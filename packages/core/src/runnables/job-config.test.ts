import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineRunnable } from './define-runnable.js';
import {
  jobConfigOrThrow,
  jobConfigs,
  mergeJobConfig,
  parseJobConfig,
} from './job-config.js';
import type { JobManifest } from './manifest.js';

const schema = z.object({
  channel: z.string(),
  recipients: z.array(z.string()).default([]),
  limits: z
    .object({ max: z.number(), min: z.number().default(0) })
    .default({ max: 10, min: 0 }),
});

describe('mergeJobConfig', () => {
  it('merges objects key by key, recursively, the job winning', () => {
    expect(
      mergeJobConfig(
        { channel: 'C1', limits: { max: 5, min: 1 }, keep: true },
        { limits: { max: 9 }, extra: 'x' },
      ),
    ).toEqual({
      channel: 'C1',
      limits: { max: 9, min: 1 },
      keep: true,
      extra: 'x',
    });
  });

  it('replaces arrays instead of appending them (Decision 81)', () => {
    expect(
      mergeJobConfig(
        { recipients: ['a@example.com', 'b@example.com'] },
        { recipients: ['c@example.com'] },
      ),
    ).toEqual({ recipients: ['c@example.com'] });
    expect(mergeJobConfig({ recipients: ['a'] }, { recipients: [] })).toEqual({
      recipients: [],
    });
  });

  it('replaces scalars, and objects with scalars or arrays (and back)', () => {
    expect(mergeJobConfig({ a: 1, b: { x: 1 }, c: [1] }, { a: 2 })).toEqual({
      a: 2,
      b: { x: 1 },
      c: [1],
    });
    expect(mergeJobConfig({ b: { x: 1 } }, { b: 'flat' })).toEqual({
      b: 'flat',
    });
    expect(mergeJobConfig({ b: { x: 1 } }, { b: [1] })).toEqual({ b: [1] });
    expect(mergeJobConfig({ b: [1] }, { b: { x: 1 } })).toEqual({
      b: { x: 1 },
    });
    expect(mergeJobConfig({ b: null }, { b: { x: 1 } })).toEqual({
      b: { x: 1 },
    });
  });

  it('keeps the base when the job sets nothing, and changes neither input', () => {
    const base = { limits: { max: 5 } };
    const over = { limits: { min: 2 } };
    expect(mergeJobConfig(base, undefined)).toBe(base);
    mergeJobConfig(base, over);
    expect(base).toEqual({ limits: { max: 5 } });
    expect(over).toEqual({ limits: { min: 2 } });
  });

  it('skips __proto__, constructor and prototype keys at every level', () => {
    // JSON.parse makes these own keys, as a config file would.
    const base: unknown = JSON.parse(
      '{"a":1,"constructor":{"x":1},"nested":{"prototype":{"y":1},"b":1}}',
    );
    const over: unknown = JSON.parse(
      '{"__proto__":{"polluted":true},"nested":{"__proto__":{"polluted":true},"c":2},"prototype":{"z":1}}',
    );
    const merged = mergeJobConfig(base, over) as Record<string, unknown>;
    expect(merged).toEqual({ a: 1, nested: { b: 1, c: 2 } });
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(merged.nested)).toBe(Object.prototype);
    expect(Object.keys(merged)).toEqual(['a', 'nested']);
    expect('polluted' in merged).toBe(false);
    expect('polluted' in {}).toBe(false);
  });
});

describe('parseJobConfig', () => {
  it('is undefined for a runnable without a configSchema', () => {
    expect(
      parseJobConfig({
        jobId: 'acme-brief',
        runnableId: 'acme-brief',
        schema: undefined,
        deltas: { 'acme-brief': { config: { channel: 'C1' } } },
      }),
    ).toEqual({ ok: true, config: undefined });
  });

  it("parses an ordinary job's own config, defaults applied", () => {
    expect(
      parseJobConfig({
        jobId: 'acme-brief',
        runnableId: 'acme-brief',
        schema,
        deltas: { 'acme-brief': { config: { channel: 'C1' } } },
      }),
    ).toEqual({
      ok: true,
      config: { channel: 'C1', recipients: [], limits: { max: 10, min: 0 } },
    });
  });

  it("merges a job's config over its runnable's", () => {
    expect(
      parseJobConfig({
        jobId: 'acme-brief-clinical',
        runnableId: 'acme-brief',
        schema,
        deltas: {
          'acme-brief': {
            config: { channel: 'C1', recipients: ['a'], limits: { max: 3 } },
          },
          'acme-brief-clinical': {
            config: { recipients: ['b'], limits: { min: 1 } },
          },
        },
      }),
    ).toEqual({
      ok: true,
      config: { channel: 'C1', recipients: ['b'], limits: { max: 3, min: 1 } },
    });
  });

  it('parses {} when no delta sets config', () => {
    expect(
      parseJobConfig({
        jobId: 'acme-brief-x',
        runnableId: 'acme-brief',
        schema: z.object({ n: z.number().default(1) }),
        deltas: {},
      }),
    ).toEqual({ ok: true, config: { n: 1 } });
  });

  it('names the job id and the entries on an invalid config', () => {
    const own = parseJobConfig({
      jobId: 'acme-brief',
      runnableId: 'acme-brief',
      schema,
      deltas: {},
    });
    expect(own.ok).toBe(false);
    expect(own.ok ? '' : own.problem).toMatch(
      /^job "acme-brief": invalid config \(jobs\.acme-brief\.config\): .*channel/s,
    );
    const merged = parseJobConfig({
      jobId: 'acme-brief-x',
      runnableId: 'acme-brief',
      schema,
      deltas: { 'acme-brief-x': { config: { channel: 7 } } },
    });
    expect(merged.ok ? '' : merged.problem).toMatch(
      /^job "acme-brief-x": invalid config \(jobs\.acme-brief\.config merged with jobs\.acme-brief-x\.config\): /,
    );
  });
});

describe('jobConfigOrThrow', () => {
  it('returns the parsed config, or throws the registration error', () => {
    const input = {
      jobId: 'acme-brief',
      runnableId: 'acme-brief',
      schema,
      deltas: {},
    };
    expect(() => jobConfigOrThrow(input)).toThrow(
      /^Invalid job config:\n- job "acme-brief": invalid config/,
    );
    expect(
      jobConfigOrThrow({
        ...input,
        deltas: { 'acme-brief': { config: { channel: 'C1' } } },
      }),
    ).toMatchObject({ channel: 'C1' });
  });
});

describe('jobConfigs', () => {
  const runnable = (id: string, configSchema?: z.ZodType) => ({
    id,
    load: () =>
      Promise.resolve(
        defineRunnable({
          id,
          domain: 'acme',
          ...(configSchema ? { configSchema } : {}),
          run: () => undefined,
        }),
      ),
  });
  const manifest = (id: string): JobManifest => ({
    id,
    domain: 'acme',
    name: id,
    description: 'x',
    schedule: '@daily',
    overlap_policy: 'skip',
    enabled: true,
    prerequisite: null,
  });

  it("parses every job's config, undefined without a schema", async () => {
    const configs = await jobConfigs({
      runnables: [runnable('acme-brief', schema), runnable('acme-plain')],
      manifests: [manifest('acme-brief'), manifest('acme-plain')],
      deltas: { 'acme-brief': { config: { channel: 'C1' } } },
    });
    expect([...configs.entries()]).toEqual([
      [
        'acme-brief',
        { channel: 'C1', recipients: [], limits: { max: 10, min: 0 } },
      ],
      ['acme-plain', undefined],
    ]);
  });

  it('lists every invalid config and every config delta with no schema to read it', async () => {
    await expect(
      jobConfigs({
        runnables: [
          runnable('acme-brief', schema),
          runnable('acme-plain'),
          runnable('acme-adhoc'),
        ],
        manifests: [manifest('acme-brief'), manifest('acme-plain')],
        deltas: {
          'acme-plain': { config: { a: 1 } },
          'acme-adhoc': { config: { a: 1 } },
        },
      }),
    ).rejects.toThrow(
      /^Invalid job config:\n- job "acme-brief": invalid config .*\n- jobs\.acme-plain\.config: runnable "acme-plain" declares no configSchema, so the config has no effect\n- jobs\.acme-adhoc\.config: runnable "acme-adhoc" declares no configSchema, so the config has no effect$/s,
    );
  });

  it('accepts a config delta on a manifest-less runnable with a schema, without parsing it alone', async () => {
    const configs = await jobConfigs({
      runnables: [runnable('acme-brief', schema)],
      manifests: [],
      deltas: { 'acme-brief': { config: { recipients: ['a'] } } },
    });
    expect(configs.size).toBe(0);
  });

  it('merges the config of a job running another runnable, and reports one whose runnable has no schema by its file', async () => {
    const job = (id: string, runnable: string): JobManifest => ({
      ...manifest(id),
      runnable,
    });
    const input = {
      runnables: [runnable('acme-brief', schema), runnable('acme-plain')],
      deltas: {
        'acme-brief': { config: { channel: 'C1' } },
        'acme-brief-x': { config: { recipients: ['b'] } },
      },
    };
    const configs = await jobConfigs({
      ...input,
      manifests: [job('acme-brief-x', 'acme-brief')],
    });
    expect(configs.get('acme-brief-x')).toEqual({
      channel: 'C1',
      recipients: ['b'],
      limits: { max: 10, min: 0 },
    });
    const plainJob = job('acme-plain-x', 'acme-plain');
    await expect(
      jobConfigs({
        ...input,
        manifests: [plainJob],
        deltas: { 'acme-plain-x': { config: { a: 1 } } },
        instanceManifests: [{ ...plainJob, domain: 'local' }],
      }),
    ).rejects.toThrow(
      /^Invalid job config:\n- jobs\/local\.json: job "acme-plain-x" runs "acme-plain", which declares no configSchema$/,
    );
    await expect(
      jobConfigs({ ...input, manifests: [plainJob], deltas: {} }),
    ).rejects.toThrow('- jobs/acme.json: job "acme-plain-x" runs "acme-plain"');
  });

  it('skips a module that fails to load: run and doctor report that', async () => {
    const configs = await jobConfigs({
      runnables: [
        { id: 'acme-broken', load: () => Promise.reject(new Error('boom')) },
      ],
      manifests: [manifest('acme-broken')],
      deltas: { 'acme-broken': { config: { a: 1 } } },
    });
    expect([...configs.entries()]).toEqual([['acme-broken', undefined]]);
  });
});
