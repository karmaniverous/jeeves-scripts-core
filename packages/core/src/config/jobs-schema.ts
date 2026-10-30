/**
 * @module config/jobs-schema
 *
 * Zod schema for the `jobs` block of `jeeves-scripts.json`: instance
 * deltas per job id (Decisions 5, 40). There is no `extensions` block
 * (Decision 50): a seam and its config arrive only on evidence (Decision
 * 8). The schedule is the runner's (`config/schedule-schema`), shared
 * with core's job manifests (`runnables/manifest`). Like `silo` and `taskFile`,
 * `extraDirs` is read by the runnable itself (`admin-sweep-orphaned-tmp`,
 * Decision 55) and has no runner effect.
 */

import { z } from 'zod';

import { isAbsolutePath } from './absolute-path.js';
import { scheduleSchema } from './schedule-schema.js';

/**
 * A runner `on_failure` target: the Slack channel, DM or user id the runner
 * alerts on a failed or timed-out run. `null` means the runner default
 * (`notifications.defaultOnFailure`); in a delta it clears a manifest value
 * (#36). Shared by manifests and deltas.
 */
export const onFailureSchema = z.string().min(1).nullable().optional();

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
  /** Failure alert target (replaces the manifest's; `null` clears it). */
  on_failure: onFailureSchema,
  /** Data silo this job's dispatcher reads and writes under (Decision 28). */
  silo: z.string().optional(),
  /** Task file path, relative to the job's silo (Decisions 23, 28). */
  taskFile: z.string().optional(),
  /**
   * Directories `admin-sweep-orphaned-tmp` sweeps in addition to the
   * content and scripts directories, with the same rules (Decision 55).
   * Absolute paths.
   */
  extraDirs: z
    .array(
      z.string().min(1).refine(isAbsolutePath, {
        message: 'extraDirs entries must be absolute paths',
      }),
    )
    .optional(),
});

/** The `jobs` block: deltas keyed by job id. */
export const jobsSchema = z.record(z.string(), jobDeltaSchema).default({});

/** Parsed delta for one job. */
export type JobDelta = z.infer<typeof jobDeltaSchema>;
/** Parsed `jobs` block. */
export type JobsConfig = z.infer<typeof jobsSchema>;
