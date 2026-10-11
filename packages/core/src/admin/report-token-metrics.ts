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

/**
 * Parse `--from` / `--to` (`--from <v>` or `--from=<v>`).
 *
 * @returns The options, or the usage error.
 */
export const parseReportArgs = (
  args: readonly string[],
): TokenMetricsOptions | string => {
  const options: TokenMetricsOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    if (flag !== '--from' && flag !== '--to')
      return `unknown argument "${arg}". ${USAGE}`;
    const value = inline ?? args[++i];
    if (value === undefined || value === '')
      return `${flag} needs a date. ${USAGE}`;
    if (Number.isNaN(Date.parse(value)))
      return `${flag} is not a valid date: ${value}. ${USAGE}`;
    options[flag === '--from' ? 'from' : 'to'] = value;
  }
  return options;
};

/** Run the report: JSON on stdout, or a usage error on stderr and exit code 1. */
export const runReport = (
  args: readonly string[],
  deps: ReportDeps = defaultDeps,
): void => {
  const options = parseReportArgs(args);
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
  run: ({ args }) => {
    runReport(args);
  },
});
