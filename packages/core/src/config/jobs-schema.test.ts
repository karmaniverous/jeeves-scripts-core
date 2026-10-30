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
