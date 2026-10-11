/**
 * @module config/jobs-schema
 *
 * Zod schema for the `jobs` block of `jeeves-scripts.json`: instance
 * deltas per job id (Decisions 5, 40). There is no `extensions` block
 * (Decision 50): a seam and its config arrive only on evidence (Decision
 * 8). The runner schedule shape is
 * shared with core's job manifests (`jobs/manifest`).
 */

import { z } from 'zod';

/**
 * A jeeves-runner schedule: either a recurrence (`freq` with `interval`,
 * `byhour`, `byminute`, `timezone`, ...) or a rule set (`rules`). Fields
 * the runner adds later pass through unchanged.
 */
export const scheduleSchema = z
  .looseObject({
    /** Frequency unit (runner schedule syntax, e.g. `minutely`, `daily`). */
    freq: z.string().optional(),
    /** Interval in `freq` units. */
    interval: z.number().int().positive().optional(),
    /** Hour(s) of the day for daily schedules. */
    byhour: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    /** Minute(s) of the hour. */
    byminute: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    /** IANA time zone the schedule is evaluated in. */
    timezone: z.string().optional(),
    /** Rule-based schedule (runner `rules` syntax). */
    rules: z.array(z.unknown()).optional(),
  })
  .refine((s) => s.freq !== undefined || s.rules !== undefined, {
    message: 'a schedule needs freq or rules',
  });

/** An instance's changes to one core job (Decision 5). */
export const jobDeltaSchema = z.object({
  /** Turn the job on or off for this instance. */
  enabled: z.boolean().optional(),
  /** Replace the job's schedule (wholesale). */
  schedule: scheduleSchema.optional(),
  /** Extra environment variables for the job, merged over the manifest's (the delta wins). */
  env: z.record(z.string(), z.string()).optional(),
  /** Extra command-line arguments for the job, appended to the manifest's. */
  args: z.array(z.string()).optional(),
  /** Run timeout in seconds (replaces the manifest's). */
  timeout_seconds: z.number().int().positive().optional(),
  /** Data silo this job's dispatcher reads and writes under (Decision 28). */
  silo: z.string().optional(),
  /** Task file path, relative to the job's silo (Decisions 23, 28). */
  taskFile: z.string().optional(),
});

/** The `jobs` block: deltas keyed by job id. */
export const jobsSchema = z.record(z.string(), jobDeltaSchema).default({});

/** Parsed delta for one job. */
export type JobDelta = z.infer<typeof jobDeltaSchema>;
/** Parsed `jobs` block. */
export type JobsConfig = z.infer<typeof jobsSchema>;
