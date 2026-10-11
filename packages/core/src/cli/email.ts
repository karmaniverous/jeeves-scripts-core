/**
 * @module cli/email
 *
 * The `email` CLI command: `email apply-labels`, the classification-label
 * catch-up (email/google-workspace/apply-labels.ts). Reads the instance
 * config and the runner store; outside a dry run it enqueues
 * `email-updates` items for drain-updates. Refuses while
 * `emailConfig.reportOnly` is on, except as a dry run.
 */

import { Command, InvalidArgumentError } from '@commander-js/extra-typings';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import {
  getBucketNames,
  getGmailAccounts,
  type LoadConfigOptions,
  pipeline,
} from '../config/index.js';
import {
  APPLY_LABELS_MAX_THREADS,
  type ApplyLabelsClient,
  type ApplyLabelsResult,
  applyPendingLabels,
} from '../email/google-workspace/apply-labels.js';

/** Parse `--since`: an ISO date or date-time. */
export const parseSince = (value: string): Date => {
  const ms = Date.parse(value);
  if (Number.isNaN(ms))
    throw new InvalidArgumentError('expected a date, e.g. 2026-10-01');
  return new Date(ms);
};

/** Parse `--max`: a positive integer. */
export const parseMax = (value: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new InvalidArgumentError('expected a positive integer');
  return n;
};

/** One summary line per account, then the total. */
export const formatApplyLabels = (r: ApplyLabelsResult): string[] => {
  const verb = r.dryRun ? 'would enqueue' : 'enqueued';
  const lines = r.accounts.map((a) => {
    const labels = Object.entries(a.labels)
      .map(([l, n]) => `${l} ${String(n)}`)
      .join(', ');
    return `${a.account}: ${String(a.threads)} of ${String(a.scanned)} threads need labels${labels ? ` (${labels})` : ''}`;
  });
  lines.push(
    `apply-labels: ${verb} ${String(r.labels)} labels${r.dryRun ? ' (dry run)' : '; drain-updates applies them'}`,
  );
  if (r.truncated)
    lines.push('apply-labels: stopped at --max; run again to continue');
  return lines;
};

/** Seams for tests. */
export interface EmailCommandDeps {
  /** Runner store client (default: jeeves-runner's `getRunnerClient`). */
  client?: () => ApplyLabelsClient & { close(): void };
}

/** Build the `email` command for an instance repo root. */
export const buildEmailCommand = (
  root: string,
  deps: EmailCommandDeps = {},
) => {
  const email = new Command('email').description(
    'Work with the email pipeline.',
  );
  email
    .command('apply-labels')
    .description(
      'Enqueue classification labels that thread state calls for but that were never applied (e.g. while emailConfig.reportOnly was on). drain-updates applies them.',
    )
    .option(
      '--since <date>',
      'only threads dated on or after this date',
      parseSince,
    )
    .option('--account <id>', 'only this Gmail account')
    .option(
      '--max <n>',
      `stop after this many threads (default ${String(APPLY_LABELS_MAX_THREADS)})`,
      parseMax,
    )
    .option('--dry-run', 'report what would be enqueued; change nothing')
    .option(
      '--config <file>',
      'config file path (default: {root}/jeeves-scripts.json, or JEEVES_SCRIPTS_CONFIG)',
    )
    .action((options) => {
      const opts: LoadConfigOptions = { root, configPath: options.config };
      const { reportOnly } = pipeline(opts).emailConfig;
      const dryRun = options.dryRun ?? false;
      if (reportOnly && !dryRun) {
        console.error(
          'apply-labels: emailConfig.reportOnly is on, so nothing may be written back to Gmail. Turn it off first, or use --dry-run.',
        );
        process.exitCode = 1;
        return;
      }
      const all = getGmailAccounts(opts);
      if (options.account && !all.includes(options.account)) {
        console.error(
          `apply-labels: ${options.account} is not a configured Gmail account (${all.join(', ') || 'none'})`,
        );
        process.exitCode = 1;
        return;
      }
      const client = (deps.client ?? getRunnerClient)();
      try {
        const result = applyPendingLabels({
          client,
          accounts: options.account ? [options.account] : all,
          buckets: getBucketNames(opts),
          since: options.since,
          dryRun,
          reportOnly,
          maxThreads: options.max,
        });
        for (const line of formatApplyLabels(result)) console.log(line);
      } finally {
        client.close();
      }
    });
  return email;
};
