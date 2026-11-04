import { describe, expect, it } from 'vitest';

import { jobsSchema } from './jobs-schema.js';

const parse = (delta: Record<string, unknown>) =>
  jobsSchema.safeParse({ 'email-poll': delta });

describe('jobs delta on_failure (#36)', () => {
  it.each([
    ['a channel id', { on_failure: 'C0123456789' }],
    ['null (clear to the runner default)', { on_failure: null }],
    ['omitted', {}],
  ])('accepts %s', (_name, delta) => {
    const result = parse(delta);
    expect(result.success).toBe(true);
    expect(result.data?.['email-poll']).toEqual(delta);
  });

  it.each([
    ['an empty string', ''],
    ['a number', 42],
  ])('rejects %s', (_name, value) => {
    const result = parse({ on_failure: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['email-poll', 'on_failure']);
  });
});

describe('admin-refresh-sessions delta fields (spec 2.12)', () => {
  const refresh = (delta: Record<string, unknown>) =>
    jobsSchema.safeParse({ 'admin-refresh-sessions': delta });

  it('accepts the fields, and their absence (the defaults apply in the job)', () => {
    const delta = {
      contextThreshold: 1,
      idleMinutes: 90,
      excludedKeys: ['agent:main:slack:channel:c0123456789'],
    };
    expect(refresh(delta).data?.['admin-refresh-sessions']).toEqual(delta);
    expect(refresh({}).success).toBe(true);
  });

  it.each([
    ['contextThreshold', 0],
    ['contextThreshold', 1.5],
    ['contextThreshold', '150000'],
    ['idleMinutes', 0],
    ['idleMinutes', -5],
    ['idleMinutes', 2.5],
    ['excludedKeys', ['']],
    ['excludedKeys', 'agent:main:main'],
    ['excludedKeys', [42]],
  ])('rejects %s: %j', (field, value) => {
    const result = refresh({ [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.slice(0, 2)).toEqual([
      'admin-refresh-sessions',
      field,
    ]);
  });
});
