/**
 * @module backfill-historical
 *
 * Paced historical Gmail backfill: each run searches ONE window per
 * account (all result pages), walking back from the newest unprocessed
 * point until the lookback limit, then no-ops. New threads are
 * classified, fetched (enqueued for download) and, unless
 * `emailConfig.reportOnly`, label actions are enqueued.
 *
 * Settings come from `pipeline.emailConfig.backfill` in jeeves-scripts.json
 * (`accounts`, `lookbackDays`, `windowDays`), overridable per field with
 * `--accounts a,b`, `--lookback-days N`, `--window-days N`. There are no
 * defaults: missing settings fail the run.
 *
 * Dry-run by default (searches and reports, writes nothing and does not
 * move the cursor). `--live` processes and advances the cursor; the
 * runner job (`jobs/email.json`, `email-backfill-historical`) passes it.
 *
 * Cursor: runner state namespace `email-backfill`, key `cursor-<email>`.
 * See backfill-settings.ts (settings), backfill-window.ts (cursor and
 * window processing) and gmail-search.ts (validated paging).
 */

import { ensureDir } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { pipeline, type PipelineConfig } from '../../config/index.js';
import { defineJob } from '../../jobs/define-job.js';
import { flag, parseRunnableArgs } from '../../lib/args.js';
import { constants } from '../../lib/constants.js';
import { type GogRunner, gogWithRetry } from '../../lib/gog.js';
import { requireGogCredentials } from '../../lib/gog-credentials.js';
import { resolveBackfillSettings } from './backfill-settings.js';
import { backfillAccount } from './backfill-window.js';

/** What {@link backfillHistorical} reads and calls. */
export interface BackfillHistoricalDeps {
  /** `pipeline.emailConfig`. */
  emailConfig: () => PipelineConfig['emailConfig'];
  /** Throws when accounts exist and gog has no credential. */
  requireGog: (accounts: number) => boolean;
  /** gog. */
  gog: GogRunner;
  /** Runner state and queues. */
  runner: () => RunnerClient;
  /** `EMAIL_EVENTS_DIR`. */
  eventsDir: string;
  /** Clock. */
  now: () => Date;
}

/** The live collaborators, from config. */
export const backfillHistoricalDeps = (): BackfillHistoricalDeps => ({
  emailConfig: () => pipeline().emailConfig,
  requireGog: (n) => requireGogCredentials('email/backfill-historical', n),
  gog: gogWithRetry,
  runner: () => getRunnerClient(),
  eventsDir: constants().EMAIL_EVENTS_DIR,
  now: () => new Date(),
});

/** Backfill one window per account (dry run unless `--live`). */
export function backfillHistorical(
  args: readonly string[],
  deps: BackfillHistoricalDeps,
): void {
  const { live } = parseRunnableArgs(args, { live: flag('--live') });
  const emailConfig = deps.emailConfig();
  const settings = resolveBackfillSettings(emailConfig.backfill, [...args]);
  const reportOnly = emailConfig.reportOnly;

  console.log(`Mode: ${live ? 'LIVE' : 'DRY-RUN'}`);
  console.log(`Accounts: ${settings.accounts.join(', ')}`);
  console.log(
    `Lookback: ${String(settings.lookbackDays)} days, window: ${String(settings.windowDays)} days`,
  );
  if (reportOnly) console.log('reportOnly: no Gmail label actions enqueued');

  deps.requireGog(settings.accounts.length);

  const client = deps.runner();
  try {
    ensureDir(deps.eventsDir);
    const now = deps.now();

    for (const account of settings.accounts) {
      console.log(`--- ${account} ---`);
      const r = backfillAccount(account, settings, {
        client,
        gog: (gogArgs) => deps.gog(gogArgs, { retries: 2, backoffMs: 5000 }),
        now,
        live,
        reportOnly,
      });
      if (!r.window) {
        console.log('  Lookback limit reached: nothing to do');
        continue;
      }
      console.log(
        `  Window:        ${r.window.after.toISOString()} .. ${r.window.before.toISOString()}`,
      );
      console.log(`  Found:         ${String(r.found)}`);
      console.log(`  Already known: ${String(r.known)}`);
      console.log(`  New:           ${String(r.new)}`);
      console.log(
        `  Labels:        ${String(r.labelsEnqueued)} enqueued / ${String(r.labelsPlanned)} planned`,
      );
      if (r.cursorAdvancedTo) {
        console.log(`  Cursor:        ${r.cursorAdvancedTo}`);
      }
    }
    if (!live) console.log('\nRe-run with --live to process and advance.');
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'email-backfill-historical',
  domain: 'email',
  name: 'email/backfill-historical',
  crashDir: () => constants().EMAIL_EVENTS_DIR,
  run: ({ args }) => {
    backfillHistorical(args, backfillHistoricalDeps());
  },
});
