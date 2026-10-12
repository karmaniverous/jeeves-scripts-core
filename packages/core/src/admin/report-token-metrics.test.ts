import { afterEach, describe, expect, it, vi } from 'vitest';

import job, { parseReportArgs, runReport } from './report-token-metrics.js';
import type { Costs } from './types/token-metrics.js';

const costs: Costs = { channels: {}, cost: 1.5, models: {}, ref: {} };

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
  });

  it('parses --from and --to, separate or inline', () => {
    expect(
      parseReportArgs(['--from', '2026-06-01', '--to=2026-06-02']),
    ).toEqual({ from: '2026-06-01', to: '2026-06-02' });
    expect(parseReportArgs([])).toEqual({});
  });

  it.each([
    [['--since', 'x'], /unknown argument "--since"/],
    [['--from'], /--from needs a date/],
    [['--to='], /--to needs a date/],
    [['--from', 'yesterday'], /--from is not a valid date: yesterday/],
  ])('rejects %j', (args, message) => {
    expect(parseReportArgs(args)).toMatch(message);
  });

  it('prints the report for the range as JSON', () => {
    const d = deps();
    runReport(['--from', '2026-06-01', '--to', '2026-06-02'], d);
    expect(d.report).toHaveBeenCalledWith({
      from: '2026-06-01',
      to: '2026-06-02',
    });
    expect(JSON.parse(String(d.out.mock.calls[0]?.[0]))).toEqual(costs);
    expect(process.exitCode).toBeUndefined();
  });

  it('prints a usage error and sets exit code 1 on bad arguments', () => {
    const d = deps();
    runReport(['--from', 'nope'], d);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.err).toHaveBeenCalledWith(
      expect.stringMatching(/^admin-report-token-metrics: --from is not/),
    );
    expect(process.exitCode).toBe(1);
  });
});
