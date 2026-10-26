/**
 * Report-only policies for tests (`ReportOnlyPolicy` stand-ins for
 * `reportOnlyFor`).
 *
 * @module config/report-only.test-helper
 */

import type { ReportOnlyPolicy } from './report-only.js';

/** No account is report-only. */
export const noneReportOnly: ReportOnlyPolicy = () => false;

/** Every account is report-only (`emailConfig.reportOnly: true`). */
export const allReportOnly: ReportOnlyPolicy = () => true;

/** Only the given accounts are report-only (`accounts[].reportOnly: true`). */
export const reportOnlyAccounts =
  (...accounts: string[]): ReportOnlyPolicy =>
  (account) =>
    accounts.includes(account);

/** `allReportOnly` when `on`, else `noneReportOnly`. */
export const reportOnlyWhen = (on: boolean): ReportOnlyPolicy =>
  on ? allReportOnly : noneReportOnly;
