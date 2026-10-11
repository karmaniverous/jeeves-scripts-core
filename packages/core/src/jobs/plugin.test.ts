import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineJob } from './define-job.js';
import {
  definePlugin,
  isJobOverride,
  isPlugin,
  localConfig,
  override,
  resetLocalConfig,
  setLocalConfig,
} from './plugin.js';

const ov = {
  job: 'email-poll',
  issue: 'karmaniverous/jeeves-scripts-core#123',
  writtenFor: '0.1.0',
  run: () => undefined,
};

describe('override', () => {
  it('returns the declaration frozen and branded', () => {
    const o = override(ov);
    expect(isJobOverride(o)).toBe(true);
    expect(Object.isFrozen(o)).toBe(true);
    expect(o).toMatchObject({ job: 'email-poll', writtenFor: '0.1.0' });
    expect(isJobOverride({ ...ov })).toBe(false);
  });

  it.each([
    ['a missing issue', { ...ov, issue: '' }, /issue/],
    ['a missing writtenFor', { ...ov, writtenFor: '' }, /writtenFor/],
    [
      'a writtenFor that is not a version',
      { ...ov, writtenFor: 'banana' },
      /exact semver[\s\S]*writtenFor/,
    ],
    ['a writtenFor range', { ...ov, writtenFor: '^0.1.0' }, /exact semver/],
    ['a bad job id', { ...ov, job: 'Email Poll' }, /override job id/],
    ['an unknown field', { ...ov, fixedIn: '0.2.0' }, /fixedIn/],
    [
      'a run that is not a function',
      { ...ov, run: 'no' },
      /run must be a function/,
    ],
  ])('rejects %s', (_label, declaration, message) => {
    expect(() => override(declaration as never)).toThrow(message);
  });

  it('accepts a prerelease writtenFor', () => {
    expect(override({ ...ov, writtenFor: '1.0.0-rc.2' }).writtenFor).toBe(
      '1.0.0-rc.2',
    );
  });
});

describe('definePlugin', () => {
  const job = defineJob({
    id: 'acme-report',
    domain: 'acme',
    run: () => undefined,
  });

  it('returns the declaration frozen and branded', () => {
    const plugin = definePlugin({
      jobs: [job],
      overrides: [override(ov)],
      configSchema: z.object({ a: z.string() }),
    });
    expect(isPlugin(plugin)).toBe(true);
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(plugin.jobs).toEqual([job]);
    expect(isPlugin(definePlugin({}))).toBe(true);
    expect(isPlugin({ jobs: [] })).toBe(false);
  });

  it.each([
    [
      'a job not made with defineJob',
      { jobs: [{ id: 'acme-x' }] },
      /defineJob/,
    ],
    ['an override not made with override', { overrides: [ov] }, /override/],
    ['a configSchema that is not a schema', { configSchema: {} }, /Zod schema/],
    ['an extensions field (Decision 50)', { extensions: {} }, /extensions/],
  ])('rejects %s', (_label, declaration, message) => {
    expect(() => definePlugin(declaration as never)).toThrow(message);
  });
});

describe('localConfig', () => {
  afterEach(() => {
    resetLocalConfig();
  });

  it('throws until a local block has been parsed', () => {
    expect(() => localConfig()).toThrow(/no local block was parsed/);
  });

  it('returns the block as the schema parsed it', () => {
    const schema = z.object({
      n: z.coerce.number(),
      d: z.string().default('x'),
    });
    setLocalConfig(schema, { n: '2' }, '/i/jeeves-scripts.json');
    const local = localConfig<typeof schema>();
    expect(local).toEqual({ n: 2, d: 'x' });
    expect(local.n + 1).toBe(3);
  });

  it('names the config file when the block is invalid', () => {
    expect(() => {
      setLocalConfig(
        z.object({ n: z.number() }),
        undefined,
        '/i/jeeves-scripts.json',
      );
    }).toThrow(/Invalid local block in \/i\/jeeves-scripts.json/);
  });
});
