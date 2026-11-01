import { parseRunnableArgs } from '@karmaniverous/jeeves';
import { afterEach, describe, expect, it, vi } from 'vitest';

import job, {
  reportFlags,
  reportOptions,
  runReport,
} from './report-token-metrics.js';
import type { Costs } from './types/token-metrics.js';

const costs: Costs = { channels: {}, cost: 1.5, models: {}, ref: {} };

const flagsOf = (args: string[]) => parseRunnableArgs(args, reportFlags);

const deps = () => ({
  report: vi.fn(() => costs),
  out: vi.fn(),
  err: vi.fn(),
});

describe('admin-report-token-metrics', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('is an admin runnable with a description (it has no manifest)', () => {
    expect(job.id).toBe('admin-report-token-metrics');
    expect(job.domain).toBe('admin');
    expect(job.description).toMatch(/--from <date>/);
    expect(Object.keys(job.flags ?? {})).toEqual(['from', 'to']);
  });

  it('parses --from and --to, separate or inline', () => {
    expect(
      reportOptions(flagsOf(['--from', '2026-06-01', '--to=2026-06-02'])),
    ).toEqual({ from: '2026-06-01', to: '2026-06-02' });
    expect(reportOptions(flagsOf([]))).toEqual({});
  });

  it.each([[['--from', 'yesterday'], /--from is not a valid date: yesterday/]])(
    'rejects %j',
    (args, message) => {
      expect(reportOptions(flagsOf(args))).toMatch(message);
    },
  );

  it('prints the report for the range as JSON', () => {
    const d = deps();
    runReport(flagsOf(['--from', '2026-06-01', '--to', '2026-06-02']), d);
    expect(d.report).toHaveBeenCalledWith({
      from: '2026-06-01',
      to: '2026-06-02',
    });
    expect(JSON.parse(String(d.out.mock.calls[0]?.[0]))).toEqual(costs);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints a usage error and sets exit code 1 on bad arguments', () => {
    const d = deps();
    runReport(flagsOf(['--from', 'nope']), d);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.err).toHaveBeenCalledWith(
      expect.stringMatching(/^admin-report-token-metrics: --from is not/),
    );
    expect(process.exitCode).toBe(1);
  });
});
