/**
 * @module config/jobs-schema
 *
 * Zod schema for the `jobs` and `extensions` blocks of
 * `jeeves-scripts.json`, stubbed only as far as the config work needs
 * (Dev Plan 4, 28, 32): instance deltas per job id and named seam
 * implementations. The job registry itself (`defineJob`, resolution) is
 * Dev Plan 5 and 31.
 */

import { z } from 'zod';

/** A runner schedule override. */
export const scheduleSchema = z.object({
  /** Frequency unit (runner schedule syntax, e.g. `minutely`, `daily`). */
  freq: z.string(),
  /** Interval in `freq` units. */
  interval: z.number().int().positive().optional(),
});

/** An instance's changes to one core job (Decision 5). */
export const jobDeltaSchema = z.object({
  /** Turn the job on or off for this instance. */
  enabled: z.boolean().optional(),
  /** Replace the job's schedule. */
  schedule: scheduleSchema.optional(),
  /** Extra environment variables for the job. */
  env: z.record(z.string(), z.string()).optional(),
  /** Extra command-line arguments for the job. */
  args: z.array(z.string()).optional(),
  /** Run timeout in seconds. */
  timeout_seconds: z.number().int().positive().optional(),
  /** Data silo this job's dispatcher reads and writes under (Decision 28). */
  silo: z.string().optional(),
  /** Task file path, relative to the job's silo (Decisions 23, 28). */
  taskFile: z.string().optional(),
});

/** The `jobs` block: deltas keyed by job id. */
export const jobsSchema = z.record(z.string(), jobDeltaSchema).default({});

/** The `extensions` block: named seam to `local:<module>` implementation (Decision 8). */
export const extensionsSchema = z.record(z.string(), z.string()).default({});

/** Parsed delta for one job. */
export type JobDelta = z.infer<typeof jobDeltaSchema>;
/** Parsed `jobs` block. */
export type JobsConfig = z.infer<typeof jobsSchema>;
/** Parsed `extensions` block. */
export type ExtensionsConfig = z.infer<typeof extensionsSchema>;
