/**
 * @module runnables/job-config
 *
 * A job's config (Decisions 79, 81): `jobs.<runnableId>.config` deep-merged
 * with `jobs.<jobId>.config`, the job winning (for an ordinary job the two
 * are one entry). Objects merge key by key; arrays and scalars replace.
 * The result is parsed with the runnable's `configSchema`; a runnable
 * without one has no config (`ctx.config` is `undefined`).
 *
 * Registration ({@link jobConfigs}) resolves the config of every job (every
 * effective manifest, a job running another runnable included, whose
 * runnable must declare a `configSchema`; Decision 80), so `config check`, `list` and `run` fail the same
 * way, naming the job id, on an invalid one. A `jobs.<id>.config` delta
 * whose runnable declares no `configSchema` has no effect, and fails
 * registration like any other inert delta (Decision 58).
 */

import { z } from 'zod';

import type { JobDelta } from '../config/jobs-schema.js';
import type { JobModule, RunnableConfigSchema } from './define-runnable.js';
import { manifestFile, noConfigSchemaProblem } from './job-instances.js';
import type { JobManifest } from './manifest.js';
import type { Runnable } from './runnables.js';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Deep-merge `over` onto `base`: plain objects merge key by key
 * (recursively); arrays and scalars in `over` replace `base`'s; an
 * `undefined` `over` keeps `base`. Neither input is changed.
 */
export const mergeJobConfig = (base: unknown, over: unknown): unknown => {
  if (over === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over))
    merged[key] = mergeJobConfig(base[key], value);
  return merged;
};

/** Inputs to {@link parseJobConfig}. */
export interface JobConfigInput {
  /** The job id the run executes as. */
  jobId: string;
  /** The runnable it runs (the job id itself for an ordinary job). */
  runnableId: string;
  /** The runnable's `configSchema`; none means no config. */
  schema: RunnableConfigSchema | undefined;
  /** The `jobs` block of the instance config. */
  deltas: Readonly<Record<string, JobDelta>>;
}

/** A parsed job config, or why it is invalid (one problem line). */
export type JobConfigResult =
  { ok: true; config: unknown } | { ok: false; problem: string };

/**
 * Merge and parse one job's config (rules in the module doc).
 */
export const parseJobConfig = ({
  jobId,
  runnableId,
  schema,
  deltas,
}: JobConfigInput): JobConfigResult => {
  if (!schema) return { ok: true, config: undefined };
  const own = deltas[runnableId]?.config;
  const merged =
    jobId === runnableId
      ? (own ?? {})
      : mergeJobConfig(own ?? {}, deltas[jobId]?.config);
  const result = schema.safeParse(merged);
  if (result.success) return { ok: true, config: result.data };
  const source =
    jobId === runnableId
      ? `jobs.${jobId}.config`
      : `jobs.${runnableId}.config merged with jobs.${jobId}.config`;
  return {
    ok: false,
    problem: `job "${jobId}": invalid config (${source}): ${z.prettifyError(result.error)}`,
  };
};

/** The error registration throws for invalid job configs. */
export const jobConfigError = (problems: readonly string[]): Error =>
  new Error(`Invalid job config:\n${problems.map((p) => `- ${p}`).join('\n')}`);

/**
 * One job's parsed config, for `run`.
 *
 * @throws {@link jobConfigError} when it is invalid.
 */
export const jobConfigOrThrow = (input: JobConfigInput): unknown => {
  const result = parseJobConfig(input);
  if (!result.ok) throw jobConfigError([result.problem]);
  return result.config;
};

/** Inputs to {@link jobConfigs}. */
export interface JobConfigsInput {
  /** Every registered runnable. */
  runnables: readonly Pick<Runnable, 'id' | 'load'>[];
  /** Every job: the effective manifests. */
  manifests: Iterable<JobManifest>;
  /** The `jobs` block of the instance config (ids already checked). */
  deltas: Readonly<Record<string, JobDelta>>;
  /**
   * The instance's manifests as read, whose files the problems of a job
   * running another runnable name. Default: none (the file is then named
   * by the runnable's domain).
   */
  instanceManifests?: readonly JobManifest[];
}

/**
 * Every job's parsed config, keyed by job id (`undefined` for a job whose
 * runnable has no `configSchema`). Loads the module of every job's
 * runnable, and of every runnable a `config` delta names. A module that
 * fails to load is skipped here: `run` and `doctor` report the load
 * failure itself.
 *
 * @throws {@link jobConfigError}, listing every invalid config and every
 *   `config` delta on a runnable without a `configSchema`.
 */
export const jobConfigs = async ({
  runnables,
  manifests,
  deltas,
  instanceManifests = [],
}: JobConfigsInput): Promise<Map<string, unknown>> => {
  const byId = new Map(runnables.map((r) => [r.id, r]));
  // null: the module failed to load.
  const modules = new Map<string, Promise<JobModule | null | undefined>>();
  const load = (id: string): Promise<JobModule | null | undefined> => {
    let job = modules.get(id);
    if (!job) {
      job = Promise.resolve(byId.get(id)?.load()).catch(() => null);
      modules.set(id, job);
    }
    return job;
  };
  const jobs = [...manifests];
  const instanceJobs = new Set(
    jobs.filter((m) => m.runnable !== undefined).map((m) => m.id),
  );
  const files = new Map(instanceManifests.map((m) => [m.id, manifestFile(m)]));
  // A job running another runnable has its config read (or its missing
  // configSchema reported) with the job itself.
  const configured = Object.entries(deltas)
    .filter(
      ([id, delta]) => delta.config !== undefined && !instanceJobs.has(id),
    )
    .map(([id]) => id);
  const [results, schemaless] = await Promise.all([
    Promise.all(
      jobs.map(async (m): Promise<JobConfigResult> => {
        const runnableId = m.runnable ?? m.id;
        const job = await load(runnableId);
        if (m.runnable !== undefined && job !== null && !job?.configSchema)
          return {
            ok: false,
            problem: noConfigSchemaProblem(
              files.get(m.id) ?? manifestFile(m),
              m.id,
              runnableId,
            ),
          };
        return parseJobConfig({
          jobId: m.id,
          runnableId,
          schema: job?.configSchema,
          deltas,
        });
      }),
    ),
    Promise.all(
      configured.map(async (id) => {
        const job = await load(id);
        return job === null || job?.configSchema ? undefined : id;
      }),
    ),
  ]);
  const problems = [
    ...results.flatMap((r) => (r.ok ? [] : [r.problem])),
    ...schemaless
      .filter((id) => id !== undefined)
      .map(
        (id) =>
          `jobs.${id}.config: runnable "${id}" declares no configSchema, so the config has no effect`,
      ),
  ];
  if (problems.length > 0) throw jobConfigError(problems);
  return new Map(
    jobs.map((m, i) => {
      const result = results[i];
      return [m.id, result?.ok ? result.config : undefined];
    }),
  );
};
