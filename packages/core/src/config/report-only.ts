/**
 * @module config/report-only
 *
 * The effective report-only flag per account: `emailConfig.reportOnly`
 * (instance-wide) or `accounts[].reportOnly === true`. An account can opt
 * into report-only, never out of it. Pure; every reader of report-only in
 * the email and meetings pipelines resolves it here.
 */

import type { PipelineConfig } from './pipeline-schema.js';

/**
 * Whether nothing may be written back to an account's mailbox (no label,
 * archive or other Gmail change).
 */
export type ReportOnlyPolicy = (account: string) => boolean;

/** The config {@link reportOnlyFor} reads. */
export interface ReportOnlyConfig {
  /** `emailConfig.reportOnly`: every account is report-only. */
  emailConfig: Pick<PipelineConfig['emailConfig'], 'reportOnly'>;
  /** `accounts[]`: `reportOnly: true` makes that one account report-only. */
  accounts: readonly Pick<
    PipelineConfig['accounts'][number],
    'email' | 'reportOnly'
  >[];
}

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * The effective report-only flag of each account:
 * `emailConfig.reportOnly || account.reportOnly === true`. Accounts are
 * matched on their trimmed, lowercased address; an address not in
 * `accounts` (e.g. a backfill-only account) follows the global flag.
 */
export function reportOnlyFor(config: ReportOnlyConfig): ReportOnlyPolicy {
  if (config.emailConfig.reportOnly) return () => true;
  const reportOnly = new Set(
    config.accounts
      .filter((a) => a.reportOnly === true)
      .map((a) => normalize(a.email)),
  );
  return (account) => reportOnly.has(normalize(account));
}
