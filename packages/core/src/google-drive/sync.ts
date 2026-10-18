/**
 * @module google-drive/sync
 *
 * Runner entry point: mirror Google Drive content shared to the
 * configured Workspace account(s) into the content tree as text.
 * Behaviour, configuration and operations are documented in
 * `src/google-drive/README.md`; the design is
 * `guides/google-drive-spec.md` (`§` references in lib/ point there).
 *
 * Flags:
 *   --live               apply changes (default: dry run, no writes anywhere)
 *   --account <email>    limit to one configured sync; in a dry run with no
 *                        configured block, synthesizes a default entry
 *   --domains <list>     delegated domains (comma-separated) for a synthesized dry-run entry
 *   --allow-mass-delete  apply deletions blocked by the mass-deletion guard
 *   --reset-state        clear the ledger + run state (requires --live)
 *   --reconvert          re-convert synced items whose copy still holds
 *                        inline base64 images (reported unless --live)
 */

import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { defineJob } from '../jobs/define-job.js';
import { constants } from '../lib/constants.js';
import {
  assertDisjointTargets,
  type BudgetConfig,
  BudgetConfigSchema,
  loadGoogleDriveConfig,
  type SyncEntryConfig,
} from './lib/config.js';
import { createRunBudget } from './lib/execute.js';
import { createLedgerStore } from './lib/ledger.js';
import { runSyncs, selectSyncs } from './lib/orchestrate.js';
import { compactMeta, exitCodeFor } from './lib/summary.js';

/** What {@link googleDriveSync} reads and calls. */
export interface GoogleDriveSyncDeps {
  /** The `googleDrive` config block (`null` when absent). */
  config: () => ReturnType<typeof loadGoogleDriveConfig>;
  /** `CONTENT_DIR` (sync targets must lie apart). */
  contentDir: string;
  /** Runner client (ledger). */
  runner: () => RunnerClient;
  /** The sync engine. */
  runSyncs: typeof runSyncs;
  /** Register the SIGTERM handler. */
  onSigterm: (handler: () => void) => void;
  /** When the process started (ms), the budget's clock. */
  startedAt: () => number;
}

/** The live collaborators, from config. */
export const googleDriveSyncDeps = (): GoogleDriveSyncDeps => ({
  config: loadGoogleDriveConfig,
  contentDir: constants().CONTENT_DIR,
  runner: () => getRunnerClient(),
  runSyncs,
  onSigterm: (handler) => {
    process.on('SIGTERM', handler);
  },
  startedAt: () => Date.now() - process.uptime() * 1000,
});

/** Run the selected syncs (dry run unless `--live`), or reset their state. */
export async function googleDriveSync(
  args: readonly string[],
  deps: GoogleDriveSyncDeps,
): Promise<void> {
  const argv = [...args];
  const live = argv.includes('--live');
  const config = deps.config();
  const configured = config?.syncs ?? [];
  assertDisjointTargets(configured, deps.contentDir);
  const syncs = selectSyncs(configured, argv, live);
  if (syncs.length === 0) {
    console.log('[skip] no googleDrive syncs configured');
    return;
  }

  const runner = deps.runner();
  try {
    if (argv.includes('--reset-state')) {
      for (const s of syncs) {
        const n = createLedgerStore(runner, s.account, live).reset();
        console.log(
          `${live ? 'RESET' : 'WOULD RESET'} ${s.account}: ${String(n)} ledger records`,
        );
      }
      return;
    }
    await sync(runner, syncs, live, config?.budget, argv, deps);
  } finally {
    runner.close();
  }
}

export default defineJob({
  id: 'google-drive-sync',
  domain: 'google-drive',
  name: 'google-drive/sync',
  run: ({ args }) => googleDriveSync(args, googleDriveSyncDeps()),
});

/** The sync proper: SIGTERM handling, the run budget, the run report. */
async function sync(
  runner: RunnerClient,
  syncs: SyncEntryConfig[],
  live: boolean,
  limits: BudgetConfig | undefined,
  argv: string[],
  deps: GoogleDriveSyncDeps,
): Promise<void> {
  let stop = false;
  deps.onSigterm(() => {
    stop = true;
    console.log('SIGTERM: finishing the current item, then stopping');
  });

  // One budget for the whole run, on the same clock as the runner's
  // timeout (process start). A synthesized dry-run entry uses the defaults.
  const budget = createRunBudget(
    limits ?? BudgetConfigSchema.parse({}),
    deps.startedAt(),
  );

  const summaries = await deps.runSyncs(syncs, runner, {
    live,
    allowMassDelete: argv.includes('--allow-mass-delete'),
    reconvert: argv.includes('--reconvert'),
    budget,
    shouldStop: () => stop,
    log: (account, line) => {
      console.log(`[${account}] ${line}`);
    },
  });

  console.log(`JR_RESULT:${JSON.stringify({ meta: compactMeta(summaries) })}`);
  process.exitCode = exitCodeFor(summaries);
}
