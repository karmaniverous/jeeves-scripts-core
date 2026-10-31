/**
 * @module github/lib/file-sync-tally
 *
 * The counts `github-sync-files` keeps while it runs (rulesets created and
 * failed, files per outcome, and every failure by name), how each result
 * is counted, the closing summary line built from them, and the single
 * error a run with failures ends in. Pure; no I/O.
 */

import type { FileResult, RulesetResult } from './file-sync.js';

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

/**
 * Count a repo's ruleset result (`undefined`: no ruleset applied there);
 * a refused create is recorded as a failure.
 */
export const tallyRuleset = (
  tally: SyncTally,
  repo: string,
  result: RulesetResult | undefined,
): void => {
  if (result === 'created') tally.rulesetsCreated++;
  if (result === 'failed') {
    tally.rulesetsFailed++;
    tally.failures.push(`${repo}: ruleset create failed`);
  }
};

/** Count one file's outcome in a repo; a failed write is recorded as a failure. */
export const tallyFile = (
  tally: SyncTally,
  repo: string,
  target: string,
  outcome: FileResult,
): void => {
  tally.files[outcome]++;
  if (outcome === 'failed')
    tally.failures.push(`${repo}: ${target} write failed`);
};

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
