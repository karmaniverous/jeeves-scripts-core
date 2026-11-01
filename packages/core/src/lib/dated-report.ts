/**
 * @module lib/dated-report
 *
 * Dated report files for runnables that keep one report per day
 * (`slack-refresh-channel-meta`, and instance runnables through the root
 * export): `<outputDir>/<YYYY-MM-DD>.md`, the date in a configured IANA
 * zone ({@link dateInZone}), written atomically ({@link deliverReport}).
 * `outputDir` is an absolute path on the host, joined with the host's own
 * `node:path`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '@karmaniverous/jeeves';

/**
 * The calendar date in a time zone, `YYYY-MM-DD` (the report's date).
 *
 * @param now - The instant.
 * @param timeZone - IANA zone.
 * @returns The date.
 */
export const dateInZone = (now: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/**
 * Where the report for a date goes.
 *
 * @param outputDir - Absolute report directory.
 * @param date - `YYYY-MM-DD`.
 * @returns `<outputDir>/<date>.md`.
 */
export const reportPath = (outputDir: string, date: string): string =>
  path.join(outputDir, `${date}.md`);

/**
 * Write the report to `<outputDir>/<date>.md` atomically (directories
 * created; an earlier report for the same date is replaced; a final
 * newline added when missing).
 *
 * @param outputDir - Absolute report directory.
 * @param date - `YYYY-MM-DD`.
 * @param report - The report text.
 * @returns The file written.
 */
export function deliverReport(
  outputDir: string,
  date: string,
  report: string,
): string {
  const file = reportPath(outputDir, date);
  fs.mkdirSync(outputDir, { recursive: true });
  atomicWrite(file, report.endsWith('\n') ? report : `${report}\n`);
  return file;
}
