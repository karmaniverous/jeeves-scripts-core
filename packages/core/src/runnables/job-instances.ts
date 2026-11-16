/**
 * @module runnables/job-instances
 *
 * Jobs that run another runnable (Decision 80): an instance manifest entry
 * (`{root}/jobs/*.json`) with `"runnable": "<id>"` runs that runnable, core
 * or instance, under the entry's id, with the entry's schedule, timeout,
 * failure target, `env` and `args`. The launcher runs it with
 * `run <jobId>`; `jobs.<jobId>` deltas apply as to any manifest (Decision
 * 58), and its config is the runnable's merged with its own (Decision 81).
 *
 * Registration fails, naming the job id and its file, when the runnable is
 * unknown, when the job id doesn't start with the runnable's domain and a
 * dash, when the job id is a runnable id (another job id is already
 * rejected by the manifest reader), or when the runnable declares no
 * `configSchema` (checked with the config, `runnables/job-config`). Core
 * manifests never set `runnable`.
 */

import type { JobManifest } from './manifest.js';
import type { Runnable } from './runnables.js';

/** The instance manifest file an entry came from (`domain` is its base name until registration). */
export const manifestFile = (m: Pick<JobManifest, 'domain'>): string =>
  `jobs/${m.domain}.json`;

/** A job entry's check: the runnable it runs, or why it can't register. */
export type JobEntryCheck<R> = { runnable: R } | { problem: string };

/**
 * Check a manifest entry that sets `runnable` against every rule but the
 * `configSchema` one.
 *
 * @param file - The entry's manifest file, for the message.
 */
export const checkJobEntry = <R extends Pick<Runnable, 'domain'>>(
  jobId: string,
  runnableId: string,
  file: string,
  runnables: ReadonlyMap<string, R>,
): JobEntryCheck<R> => {
  const runnable = runnables.get(runnableId);
  if (!runnable)
    return {
      problem: `${file}: job "${jobId}" runs "${runnableId}", which is not a registered runnable`,
    };
  if (runnables.has(jobId))
    return {
      problem: `${file}: job "${jobId}" collides with the runnable of that id`,
    };
  if (!jobId.startsWith(`${runnable.domain}-`))
    return {
      problem: `${file}: job "${jobId}" must start with "${runnable.domain}-", the domain of runnable "${runnableId}"`,
    };
  return { runnable };
};

/** The `configSchema` rule's problem line (see the module doc). */
export const noConfigSchemaProblem = (
  file: string,
  jobId: string,
  runnableId: string,
): string =>
  `${file}: job "${jobId}" runs "${runnableId}", which declares no configSchema`;

/**
 * The runnables plus one entry per job that runs another runnable (it
 * loads that runnable, and shows it as `runnable`), sorted by id.
 */
export const withJobs = (
  runnables: readonly Runnable[],
  manifests: Iterable<JobManifest>,
): Runnable[] => {
  const byId = new Map(runnables.map((r) => [r.id, r]));
  const jobs: Runnable[] = [];
  for (const m of manifests) {
    const target = m.runnable === undefined ? undefined : byId.get(m.runnable);
    if (target)
      jobs.push({
        id: m.id,
        domain: target.domain,
        source: target.source,
        runnable: target.id,
        load: target.load,
      });
  }
  return [...runnables, ...jobs].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
};
