import { describe, expect, it } from 'vitest';

import { resolveDryRun } from './run-mode.js';

describe('resolveDryRun', () => {
  it('is a live run only when nothing asks for a dry run', () => {
    expect(
      resolveDryRun({
        respondDryRun: undefined,
        reportOnly: false,
        dryRunFlag: false,
      }),
    ).toBe(false);
  });

  it('treats emailConfig.reportOnly as a dry run', () => {
    expect(
      resolveDryRun({
        respondDryRun: false,
        reportOnly: true,
        dryRunFlag: false,
      }),
    ).toBe(true);
  });

  it('honours respond.dryRun and --dry-run', () => {
    expect(
      resolveDryRun({
        respondDryRun: true,
        reportOnly: false,
        dryRunFlag: false,
      }),
    ).toBe(true);
    expect(
      resolveDryRun({
        respondDryRun: undefined,
        reportOnly: false,
        dryRunFlag: true,
      }),
    ).toBe(true);
  });
});
