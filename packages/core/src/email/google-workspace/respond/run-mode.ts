/**
 * @module run-mode
 *
 * Decides whether an email-respond run is a dry run. Report-only mode
 * (`emailConfig.reportOnly`) means no Gmail changes anywhere in the email
 * pipeline, so it forces a dry run here too: no dispatch, no send, no
 * labels, no state writes.
 */

/** Inputs for {@link resolveDryRun}. */
export interface RunModeInput {
  /** `emailConfig.respond.dryRun`. */
  respondDryRun: boolean | undefined;
  /** `emailConfig.reportOnly`. */
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
