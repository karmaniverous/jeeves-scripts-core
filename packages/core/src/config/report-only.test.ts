/**
 * Tests for the effective per-account report-only flag
 * (`emailConfig.reportOnly || accounts[].reportOnly === true`) and the
 * `accounts[].reportOnly` schema key.
 */

import { describe, expect, it } from 'vitest';

import { accountSchema } from './pipeline-schema.js';
import { reportOnlyFor } from './report-only.js';

const config = (
  global: boolean,
  accounts: Record<string, boolean | undefined>,
) => ({
  emailConfig: { reportOnly: global },
  accounts: Object.entries(accounts).map(([email, reportOnly]) => ({
    email,
    ...(reportOnly === undefined ? {} : { reportOnly }),
  })),
});

describe('reportOnlyFor', () => {
  it.each([
    // global, account flag, effective
    [false, undefined, false],
    [false, false, false],
    [false, true, true],
    [true, undefined, true],
    [true, false, true],
    [true, true, true],
  ])('global %s and account %s resolve to %s', (global, flag, expected) => {
    const policy = reportOnlyFor(
      config(global, { 'a@example.com': flag, 'b@example.com': undefined }),
    );
    expect(policy('a@example.com')).toBe(expected);
    // The other account follows the global flag only.
    expect(policy('b@example.com')).toBe(global);
  });

  it('matches accounts case- and whitespace-insensitively', () => {
    const policy = reportOnlyFor(
      config(false, { ' Shared@Example.com ': true }),
    );
    expect(policy('shared@example.com')).toBe(true);
    expect(policy('SHARED@EXAMPLE.COM')).toBe(true);
    expect(policy('other@example.com')).toBe(false);
  });

  it('treats an account missing from accounts[] (backfill-only) by the global flag', () => {
    expect(reportOnlyFor(config(false, {}))('x@example.com')).toBe(false);
    expect(reportOnlyFor(config(true, {}))('x@example.com')).toBe(true);
  });
});

describe('accounts[].reportOnly schema', () => {
  const account = { email: 'a@example.com', type: 'gmail', emailPolling: true };

  it('is optional and accepts a boolean', () => {
    expect(accountSchema.parse(account).reportOnly).toBeUndefined();
    expect(
      accountSchema.parse({ ...account, reportOnly: true }).reportOnly,
    ).toBe(true);
  });

  it('rejects a non-boolean', () => {
    expect(
      accountSchema.safeParse({ ...account, reportOnly: 'yes' }).success,
    ).toBe(false);
  });
});
