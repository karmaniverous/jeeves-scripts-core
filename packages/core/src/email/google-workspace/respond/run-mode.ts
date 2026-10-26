/**
 * @module run-mode
 *
 * Decides whether an email-respond run is a dry run. A report-only
 * mailbox (`emailConfig.reportOnly`, or the mailbox's own
 * `accounts[].reportOnly`) gets no Gmail changes, so it forces a dry run
 * here too: no dispatch, no send, no labels, no state writes.
 */

/** Inputs for {@link resolveDryRun}. */
export interface RunModeInput {
  /** `emailConfig.respond.dryRun`. */
  respondDryRun: boolean | undefined;
  /** The mailbox's effective report-only flag (`reportOnlyFor`). */
  reportOnly: boolean;
  /** The declared `--dry-run` flag. */
  dryRunFlag: boolean;
}

/**
 * Whether this run must only discover and qualify.
 *
 * @returns true when `reportOnly`, `respond.dryRun` or `--dry-run` is set.
 */
export function resolveDryRun(input: RunModeInput): boolean {
  return input.reportOnly || input.respondDryRun === true || input.dryRunFlag;
}
