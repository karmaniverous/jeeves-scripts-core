/**
 * @module punch-list/harvest/report
 *
 * The harvest worker's report: its final reply is one JSON
 * object, validated here before anything is written. Sources are absolute
 * file paths from watcher hits, or telemetry references
 * (`runner:<job>#<run>`, `watcher:<path>`, `meta:<path>`, `session:<key>`).
 */

import { z } from 'zod';

import { isAbsolutePath } from '../../config/absolute-path.js';

export const TELEMETRY_REF_RE = /^(runner|watcher|meta):\S+$/;

export const sourceSchema = z
  .string()
  .trim()
  .refine((s) => isAbsolutePath(s) || TELEMETRY_REF_RE.test(s), {
    message: 'a source is an absolute file path or a telemetry reference',
  });

export const reportItemSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    why: z.string().trim().min(3).max(600),
    kind: z.enum(['requested', 'inferred']),
    /** Who asked, for `requested` items. */
    /** Who asked; an empty string (as workers write for inferred items) counts as none. */
    requester: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().min(1).optional(),
    ),
    sources: z.array(sourceSchema).min(1),
  })
  .refine((i) => i.kind !== 'requested' || i.requester !== undefined, {
    message: 'a requested item names its requester',
    path: ['requester'],
  });
export type ReportItem = z.infer<typeof reportItemSchema>;

export const harvestReportSchema = z.object({
  items: z.array(reportItemSchema),
  summary: z.string().trim(),
});
export type HarvestReport = z.infer<typeof harvestReportSchema>;

/** The reply a worker gives when a tool it needs failed. */
export const FAILURE_SENTINEL = 'HARVEST_FAILED:';

/**
 * Parse the worker's final reply: the JSON object, optionally inside a
 * code fence or surrounded by prose.
 *
 * @throws When the worker reported a failure, or there is no JSON object,
 * or it does not match the schema.
 */
export const parseReport = (reply: string): HarvestReport => {
  const failed = reply.indexOf(FAILURE_SENTINEL);
  if (failed >= 0) {
    throw new Error(
      `harvest worker failed: ${reply.slice(failed + FAILURE_SENTINEL.length).trim()}`,
    );
  }
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new Error('harvest worker reply holds no JSON object');
  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1));
  } catch (err) {
    throw new Error(
      `harvest worker reply is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return harvestReportSchema.parse(json);
};
