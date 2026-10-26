/**
 * @module email/email-apply-labels
 *
 * The runnable `email-apply-labels` (Decision 49), with options
 * `--since <date>`, `--account <id>`, `--max <n>`, `--dry-run` and
 * `--config <file>`: the classification-label catch-up (`google-workspace/apply-labels.ts`).
 * Reads the instance config and the runner store; outside a dry run it
 * enqueues `email-updates` items for drain-updates. Report-only accounts
 * (`emailConfig.reportOnly` or `accounts[].reportOnly`) are skipped; when
 * every target account is report-only it refuses (exit 1), except as a dry
 * run. An invalid option or an unknown account also exits 1. Run with
 * `jeeves-scripts run email-apply-labels`; it has no manifest.
 */

import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import {
  getBucketNames,
  getGmailAccounts,
  type LoadConfigOptions,
  pipeline,
  reportOnlyFor,
  resetConfig,
} from '../config/index.js';
import { defineJob } from '../jobs/define-job.js';
import { argFlag, argOptional, type ParsedArgs } from '../lib/args.js';
import {
  APPLY_LABELS_MAX_THREADS,
  type ApplyLabelsClient,
  type ApplyLabelsResult,
  applyPendingLabels,
} from './google-workspace/apply-labels.js';

/** Parse `--since`: an ISO date or date-time. */
export const parseSince = (value: string): Date => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms))
    throw new Error(`--since: expected a date, e.g. 2026-10-01 (got ${value})`);
  return new Date(ms);
};

/** Parse `--max`: a positive integer. */
export const parseMax = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--max: expected a positive integer (got ${value})`);
  return n;
};

/** One summary line per account, then the total. */
export const formatApplyLabels = (r: ApplyLabelsResult): string[] => {
  const verb = r.dryRun ? 'would enqueue' : 'enqueued';
  const lines = r.accounts.map((a) => {
    if (a.reportOnly && !r.dryRun) return `${a.account}: report-only, skipped`;
    const labels = Object.entries(a.labels)
      .map(([l, n]) => `${l} ${String(n)}`)
      .join(', ');
    const note = a.reportOnly ? '; report-only, skipped outside a dry run' : '';
    return `${a.account}: ${String(a.threads)} of ${String(a.scanned)} threads need labels${labels ? ` (${labels})` : ''}${note}`;
  });
  lines.push(
    `apply-labels: ${verb} ${String(r.labels)} labels${r.dryRun ? ' (dry run)' : '; drain-updates applies them'}`,
  );
  if (r.truncated)
    lines.push('apply-labels: stopped at --max; run again to continue');
  return lines;
};

/** Seams for tests. */
export interface ApplyLabelsDeps {
  /** Runner store client (default: jeeves-runner's `getRunnerClient`). */
  client?: () => ApplyLabelsClient & { close(): void };
}

/** The flags `email-apply-labels` accepts. */
export const applyLabelsFlags = {
  since: argOptional('--since', {
    description: 'Only messages after this date',
  }),
  account: argOptional('--account', {
    description: 'One configured Gmail account',
  }),
  max: argOptional('--max', {
    description: 'Messages to process (positive integer)',
  }),
  dryRun: argFlag('--dry-run', 'Report the labels; apply nothing'),
  config: argOptional('--config', {
    description: 'Path to jeeves-scripts.json',
  }),
};

/** Parsed {@link applyLabelsFlags}. */
export type ApplyLabelsFlags = ParsedArgs<typeof applyLabelsFlags>;

/** Validated options, or the message for an invalid one. */
const parseOptions = (values: Partial<ApplyLabelsFlags>) => {
  try {
    return {
      since: values.since === undefined ? undefined : parseSince(values.since),
      account: values.account,
      max: values.max === undefined ? undefined : parseMax(values.max),
      dryRun: values.dryRun ?? false,
      config: values.config,
    };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/**
 * Run `email-apply-labels` with its parsed flags. Problems are
 * printed to stderr with `process.exitCode = 1`; nothing throws for them.
 */
export function emailApplyLabels(
  flags: Partial<ApplyLabelsFlags>,
  deps: ApplyLabelsDeps = {},
): void {
  const fail = (message: string) => {
    console.error(`apply-labels: ${message}`);
    process.exitCode = 1;
  };
  const options = parseOptions(flags);
  if (typeof options === 'string') {
    fail(options);
    return;
  }
  // The config may already be cached (an instance plugin with a local
  // schema loads it at registration), so an explicit --config replaces it.
  if (options.config) resetConfig();
  const opts: LoadConfigOptions = { configPath: options.config };
  const reportOnly = reportOnlyFor(pipeline(opts));
  const all = getGmailAccounts(opts);
  if (options.account && !all.includes(options.account)) {
    fail(
      `${options.account} is not a configured Gmail account (${all.join(', ') || 'none'})`,
    );
    return;
  }
  const accounts = options.account ? [options.account] : all;
  if (
    !options.dryRun &&
    accounts.length > 0 &&
    accounts.every((a) => reportOnly(a))
  ) {
    fail(
      'every target account is report-only (emailConfig.reportOnly or accounts[].reportOnly), so nothing may be written back to Gmail. Turn it off first, or use --dry-run.',
    );
    return;
  }
  const client = (deps.client ?? getRunnerClient)();
  try {
    const result = applyPendingLabels({
      client,
      accounts,
      buckets: getBucketNames(opts),
      since: options.since,
      dryRun: options.dryRun,
      reportOnly,
      maxThreads: options.max,
    });
    for (const line of formatApplyLabels(result)) console.log(line);
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'email-apply-labels',
  domain: 'email',
  description: `Enqueue classification labels thread state calls for but that were never applied (e.g. while reportOnly was on); drain-updates applies them. Default --max ${String(APPLY_LABELS_MAX_THREADS)}.`,
  flags: applyLabelsFlags,
  run: ({ flags }) => {
    emailApplyLabels(flags);
  },
});
