/**
 * @module config/jobs-schema
 *
 * Zod schema for the `jobs` and `extensions` blocks of
 * `jeeves-scripts.json` — stubbed only as far as this slice's config work
 * needs (Dev Plan row 4/28/32): instance deltas per job id (schedule,
 * enabled, env, args, timeout) and named seam implementations. The job
 * registry itself (`defineJob`, resolution) is Dev Plan row 5/31.
 */

import { z } from 'zod';

const scheduleSchema = z.object({
  freq: z.string(),
  interval: z.number().int().positive().optional(),
});

export const jobDeltaSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: scheduleSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  args: z.array(z.string()).optional(),
  timeout_seconds: z.number().int().positive().optional(),
  /** Data silo this job's dispatcher reads/writes under (Decision 28). */
  silo: z.string().optional(),
  /** Task-file path, relative to the job's silo (Decision 23, 28). */
  taskFile: z.string().optional(),
});

export const jobsSchema = z.record(z.string(), jobDeltaSchema).default({});

/** `extensions`: named seam → `local:<module>` implementation (Decision 8). */
export const extensionsSchema = z.record(z.string(), z.string()).default({});

export type JobDelta = z.infer<typeof jobDeltaSchema>;
export type JobsConfig = z.infer<typeof jobsSchema>;
export type ExtensionsConfig = z.infer<typeof extensionsSchema>;
