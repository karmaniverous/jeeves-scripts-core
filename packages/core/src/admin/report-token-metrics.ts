/**
 * @module admin/report-token-metrics
 *
 * The runnable `admin-report-token-metrics [--from <date>] [--to <date>]`:
 * prints the `getTokenMetrics` cost report for the range as JSON on
 * stdout. No manifest; run on demand
 * (`jeeves-scripts run admin-report-token-metrics --from 2026-06-01 --to 2026-06-30`).
 * Reads the token-metrics buckets and the rate card; writes nothing.
 */

import { defineJob } from '../jobs/define-job.js';
import { argOptional, type ParsedArgs } from '../lib/args.js';
import { getTokenMetrics, type TokenMetricsOptions } from './token-metrics.js';

/** Seams for tests. */
export interface ReportDeps {
  /** Builds the report. Default: {@link getTokenMetrics}. */
  report: typeof getTokenMetrics;
  /** Prints the report. */
  out: (text: string) => void;
  /** Prints a usage error. */
  err: (text: string) => void;
}

const defaultDeps: ReportDeps = {
  report: getTokenMetrics,
  out: (text) => {
    console.log(text);
  },
  err: (text) => {
    console.error(text);
  },
};

const ID = 'admin-report-token-metrics';
const USAGE = `usage: ${ID} [--from <date>] [--to <date>]`;

/** The flags `admin-report-token-metrics` accepts. */
export const reportFlags = {
  from: argOptional('--from', { description: 'Range start (a date)' }),
  to: argOptional('--to', { description: 'Range end (a date)' }),
};

/**
 * Validate the parsed `--from` / `--to` dates.
 *
 * @returns The options, or the usage error.
 */
export const reportOptions = (
  flags: ParsedArgs<typeof reportFlags>,
): TokenMetricsOptions | string => {
  const options: TokenMetricsOptions = {};
  for (const key of ['from', 'to'] as const) {
    const value = flags[key];
    if (value === undefined) continue;
    if (value === '') return `--${key} needs a date. ${USAGE}`;
    if (Number.isNaN(Date.parse(value)))
      return `--${key} is not a valid date: ${value}. ${USAGE}`;
    options[key] = value;
  }
  return options;
};

/** Run the report: JSON on stdout, or a usage error on stderr and exit code 1. */
export const runReport = (
  flags: ParsedArgs<typeof reportFlags>,
  deps: ReportDeps = defaultDeps,
): void => {
  const options = reportOptions(flags);
  if (typeof options === 'string') {
    deps.err(`${ID}: ${options}`);
    process.exitCode = 1;
    return;
  }
  deps.out(JSON.stringify(deps.report(options), null, 2));
};

export default defineJob({
  id: ID,
  domain: 'admin',
  description:
    'Print the token cost report for [--from <date>] [--to <date>] as JSON (getTokenMetrics).',
  flags: reportFlags,
  run: ({ flags }) => {
    runReport(flags);
  },
});
