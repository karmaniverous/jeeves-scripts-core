/**
 * @module punch-list/harvest/record
 *
 * Harvest records. Each dispatched harvest is
 * saved under `<dir>/harvest/` before anything is written to the punch
 * list, with the items it will add; it is marked delivered only after the
 * Backlog merge and the Slack post. A run that finds an undelivered record
 * finishes it first, without dispatching again, so a failure after the
 * worker replied never loses items or their notification.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { readJsonFile, writeJsonFile } from '../../lib/json-file.js';
import { harvestReportSchema, reportItemSchema } from './report.js';

export const harvestRecordSchema = z.object({
  /** When the run that dispatched the worker started. */
  at: z.iso.datetime(),
  /** Start of the window the worker looked at. */
  since: z.iso.datetime(),
  report: harvestReportSchema,
  /** Items this harvest adds to Backlog. */
  added: z.array(reportItemSchema),
  skipped: z.array(z.object({ title: z.string(), reason: z.string() })),
  /** Merged into Backlog and posted. */
  delivered: z.boolean(),
});
export type HarvestRecord = z.infer<typeof harvestRecordSchema>;

const harvestDir = (dir: string): string => join(dir, 'harvest');

/** A run's file name: `2026-10-18T21-47-00Z.json` for a run started at `at`. */
export const runFileName = (at: Date): string =>
  `${at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-')}.json`;

/** `<dir>/harvest/<run file name>` for a run started at `at`. */
export const recordPath = (dir: string, at: Date): string =>
  join(harvestDir(dir), runFileName(at));

/** Save a record atomically. */
export const writeRecord = (file: string, record: HarvestRecord): void => {
  writeJsonFile(file, harvestRecordSchema.parse(record));
};

/** Undelivered records, oldest first. */
export const undeliveredRecords = (
  dir: string,
): { file: string; record: HarvestRecord }[] => {
  const d = harvestDir(dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: join(d, f),
      record: readJsonFile(join(d, f), harvestRecordSchema),
    }))
    .filter(({ record }) => !record.delivered);
};
