/**
 * @module jobs/runnables
 *
 * Registration (Decisions 6, 27, 49, 50; R19, R20, R45): core's registry
 * plus the instance plugin's runnables and overrides, checked against each
 * other, and every runnable's effective manifest (core's and the
 * instance's `{root}/jobs/*.json`, with the `jobs` deltas applied).
 *
 * Rules, each failing registration with the ids at fault:
 *
 * - a plugin runnable never reuses a core id (declare an override) nor a
 *   core domain, and plugin ids are unique;
 * - an override names a core runnable, at most once;
 * - an instance manifest names a registered runnable that has no core
 *   manifest: an instance runnable, or a manifest-less core runnable
 *   (Decision 50); a core manifest changes only through deltas.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { JobDelta } from '../config/jobs-schema.js';
import { defineJob, type JobModule } from './define-job.js';
import {
  effectiveManifests,
  type JobManifest,
  readCoreManifests,
} from './manifest.js';
import type { Plugin } from './plugin.js';
import {
  coreDomains,
  coreJobs,
  loadJob,
  type RegistryEntry,
} from './registry.js';

/** Where a runnable's code comes from (`list`'s `source` column). */
export type RunnableSource = 'core' | 'instance' | 'override';

/** One registered runnable. */
export interface Runnable {
  /** Runnable id. */
  id: string;
  /** Its domain. */
  domain: string;
  /** Core, instance, or a plugin override of a core id. */
  source: RunnableSource;
  /** Core's registry entry (core runnables and overrides). */
  core?: RegistryEntry;
  /** The runnable to run. */
  load: () => Promise<JobModule>;
}

/** Inputs to {@link buildRunnables}. */
export interface BuildRunnablesInput {
  /** The instance plugin, if the instance has one. */
  plugin?: Plugin;
  /** Core's registry. Default: core's. */
  registry?: readonly RegistryEntry[];
  /** Core's domains. Default: core's. */
  domains?: readonly string[];
}

/**
 * Every registered runnable, sorted by id: core's (an override in place of
 * the core runnable it names) and the plugin's.
 *
 * @throws When the plugin breaks a rule in the module doc, listing every
 *   problem.
 */
export const buildRunnables = ({
  plugin,
  registry = coreJobs,
  domains = coreDomains,
}: BuildRunnablesInput = {}): Runnable[] => {
  const problems: string[] = [];
  const core = new Map(registry.map((e) => [e.id, e]));

  const instance = new Map<string, JobModule>();
  for (const job of plugin?.jobs ?? []) {
    if (core.has(job.id))
      problems.push(
        `runnable "${job.id}" reuses a core id; declare an override of it instead`,
      );
    else if (domains.includes(job.domain))
      problems.push(
        `runnable "${job.id}": domain "${job.domain}" is a core domain; instance domains never reuse one`,
      );
    else if (instance.has(job.id))
      problems.push(`runnable "${job.id}" is registered twice`);
    else instance.set(job.id, job);
  }

  const overrides = new Map<string, Runnable>();
  for (const o of plugin?.overrides ?? []) {
    const entry = core.get(o.job);
    if (!entry) problems.push(`override "${o.job}" names no core runnable`);
    else if (overrides.has(o.job))
      problems.push(`override "${o.job}" is declared twice`);
    else
      overrides.set(o.job, {
        id: entry.id,
        domain: entry.domain,
        source: 'override',
        core: entry,
        load: () =>
          Promise.resolve(
            defineJob({
              id: entry.id,
              domain: entry.domain,
              ...(o.prerequisite ? { prerequisite: o.prerequisite } : {}),
              run: o.run,
            }),
          ),
      });
  }

  if (problems.length > 0)
    throw new Error(
      `Invalid jeeves-scripts.plugin.ts:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    );

  return [
    ...registry.map(
      (e): Runnable =>
        overrides.get(e.id) ?? {
          id: e.id,
          domain: e.domain,
          source: 'core',
          core: e,
          load: () => loadJob(e),
        },
    ),
    ...[...instance.values()].map((job): Runnable => ({
      id: job.id,
      domain: job.domain,
      source: 'instance',
      load: () => Promise.resolve(job),
    })),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/**
 * The instance's manifests, `{root}/jobs/*.json` in core's format.
 * `domain` is the file's base name until {@link registeredManifests} sets
 * it from the runnable.
 *
 * @throws As {@link readCoreManifests} does.
 */
export const readInstanceManifests = (root: string): JobManifest[] => {
  const dir = path.join(root, 'jobs');
  return fs.existsSync(dir) ? readCoreManifests(dir) : [];
};

/** Inputs to {@link registeredManifests}. */
export interface RegisteredManifestsInput {
  /** Every registered runnable ({@link buildRunnables}). */
  runnables: readonly Runnable[];
  /** Core's manifests. */
  coreManifests: readonly JobManifest[];
  /** The instance's manifests ({@link readInstanceManifests}). */
  instanceManifests: readonly JobManifest[];
  /** The `jobs` block of `jeeves-scripts.json`. */
  deltas: Readonly<Record<string, JobDelta>>;
}

/**
 * Every runnable's effective manifest (deltas applied), keyed by id;
 * runnables without one are absent.
 *
 * @throws When an instance manifest breaks a rule in the module doc, or a
 *   delta names an unregistered id.
 */
export const registeredManifests = ({
  runnables,
  coreManifests,
  instanceManifests,
  deltas,
}: RegisteredManifestsInput): Map<string, JobManifest> => {
  const byId = new Map(runnables.map((r) => [r.id, r]));
  const coreIds = new Set(coreManifests.map((m) => m.id));
  const problems: string[] = [];
  const instance: JobManifest[] = [];
  for (const m of instanceManifests) {
    const runnable = byId.get(m.id);
    const file = `jobs/${m.domain}.json`;
    if (!runnable)
      problems.push(`${file}: "${m.id}" is not a registered runnable`);
    else if (coreIds.has(m.id))
      problems.push(
        `${file}: "${m.id}" has a core manifest; change it with jobs.${m.id} in jeeves-scripts.json`,
      );
    else instance.push({ ...m, domain: runnable.domain });
  }
  if (problems.length > 0)
    throw new Error(
      `Invalid instance manifests:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    );
  const effective = effectiveManifests({
    manifests: [...coreManifests, ...instance],
    deltas,
    knownIds: new Set(byId.keys()),
  });
  return new Map(effective.map((m) => [m.id, m]));
};
