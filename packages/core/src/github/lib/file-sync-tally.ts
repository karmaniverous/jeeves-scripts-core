/**
 * @module github/lib/file-sync-tally
 *
 * The counts `github-sync-files` keeps while it runs (rulesets created and
 * failed, files per outcome, and every failure by name), the closing
 * summary line built from them, and the single error a run with failures
 * ends in. Pure; no I/O.
 */

import type { FileResult } from './file-sync.js';

/** Log prefix and runner-state namespace: the runnable id. */
export const SYNC_FILES_ID = 'github-sync-files';

/** Counts for the summary line, and what failed. */
export interface SyncTally {
  rulesetsCreated: number;
  rulesetsFailed: number;
  files: Record<FileResult, number>;
  failures: string[];
}

/** An empty tally. */
export const newTally = (): SyncTally => ({
  rulesetsCreated: 0,
  rulesetsFailed: 0,
  files: { created: 0, updated: 0, skipped: 0, protected: 0, failed: 0 },
  failures: [],
});

/** The closing summary line. */
export const summaryLine = ({
  rulesetsCreated,
  rulesetsFailed,
  files: f,
}: SyncTally): string =>
  [
    `[${SYNC_FILES_ID}] done:`,
    `rulesets created=${String(rulesetsCreated)}`,
    `failed=${String(rulesetsFailed)}`,
    `files created=${String(f.created)}`,
    `updated=${String(f.updated)}`,
    `skipped=${String(f.skipped)}`,
    `protected=${String(f.protected)}`,
    `failed=${String(f.failed)}`,
  ].join(' ');

/** The one error a run with failures ends in, naming every failure. */
export const failuresError = ({ failures }: SyncTally): Error =>
  new Error(
    `${SYNC_FILES_ID}: ${String(failures.length)} failure(s); last-run not recorded: ${failures.join('; ')}`,
  );
