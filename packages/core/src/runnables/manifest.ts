/**
 * @module runnables/manifest
 *
 * Core's runnable manifests (Decisions 5, 40, 49): `jobs/<domain>.json`
 * in the package, each an object keyed by runnable id holding the runner
 * fields for a scheduled core runnable (no `script`: runner jobs run the
 * instance launcher with `run <id>`). Reads and validates them with Zod, and applies an
 * instance's `jobs` deltas from `jeeves-scripts.json`.
 *
 * Delta rules: `enabled`, `timeout_seconds`, `schedule` and `on_failure`
 * replace the manifest's (`on_failure: null` clears it); `env` merges key by key (the delta wins); `args` are
 * appended. A delta naming an id that is neither a core nor an
 * instance runnable is an error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { type JobDelta, onFailureSchema } from '../config/jobs-schema.js';
import { scheduleSchema } from '../config/schedule-schema.js';

/** One scheduled core job, as its manifest file holds it. */
export const manifestEntrySchema = z.strictObject({
  /** Display name. */
  name: z.string().min(1),
  /** What the job does. */
  description: z.string().min(1),
  /** Default schedule, in any form the runner accepts (`config/schedule-schema`). */
  schedule: scheduleSchema,
  /** Default arguments after `run <id>`. */
  args: z.array(z.string()).optional(),
  /** Default environment. */
  env: z.record(z.string(), z.string()).optional(),
  /** Runner overlap policy (e.g. `skip`). */
  overlap_policy: z.string().min(1),
  /** Run timeout in seconds; omitted means none, as in the runner (Decision 54). */
  timeout_seconds: z.number().int().positive().optional(),
  /**
   * Slack target the runner alerts when a run fails or times out (a channel,
   * DM or user id, as the runner expects); omitted or `null` means the
   * runner's `notifications.defaultOnFailure` (#36).
   */
  on_failure: onFailureSchema,
  /** Enabled by default. */
  enabled: z.boolean(),
  /** What must be set up first; `null` when nothing (deploy registers only these). */
  prerequisite: z.string().min(1).nullable(),
});

/** One `jobs/<domain>.json` file: entries keyed by job id. */
export const manifestFileSchema = z.record(z.string(), manifestEntrySchema);

/** One scheduled core job. */
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/** A manifest entry with its id and domain (the file it came from). */
export type JobManifest = ManifestEntry & { id: string; domain: string };

/** Core's `jobs/` directory: two levels up from `src/runnables` or `dist/runnables`. */
export const coreManifestDir = (): string =>
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'jobs',
  );

/**
 * Every core manifest entry, in file-name then file order.
 *
 * @param dir - Manifest directory. Default: core's shipped `jobs/`.
 * @throws When a file is not valid JSON (the message names the file and
 *   the parser's position), an entry is invalid, or an id appears twice;
 *   the message names the file by its path.
 */
export const readCoreManifests = (
  dir: string = coreManifestDir(),
): JobManifest[] => {
  const seen = new Map<string, string>();
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      let json: unknown;
      try {
        json = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        throw new Error(
          `Invalid JSON in job manifest ${file}: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
      const result = manifestFileSchema.safeParse(json);
      if (!result.success)
        throw new Error(
          `Invalid job manifest ${file}: ${z.prettifyError(result.error)}`,
        );
      const domain = name.slice(0, -'.json'.length);
      return Object.entries(result.data).map(([id, entry]) => {
        const other = seen.get(id);
        if (other)
          throw new Error(`Job "${id}" is in both ${other} and ${file}.`);
        seen.set(id, file);
        return { id, domain, ...entry };
      });
    });
};

/** The delta fields that only shape a runner job (a manifest). */
const RUNNER_FIELDS = [
  'enabled',
  'schedule',
  'timeout_seconds',
  'on_failure',
  'env',
  'args',
] as const;

/** Apply one instance delta to a manifest entry (rules in the module doc). */
export const applyDelta = (
  manifest: JobManifest,
  delta: JobDelta | undefined,
): JobManifest => {
  if (!delta) return manifest;
  const env =
    delta.env === undefined ? manifest.env : { ...manifest.env, ...delta.env };
  const args =
    delta.args === undefined
      ? manifest.args
      : [...(manifest.args ?? []), ...delta.args];
  return {
    ...manifest,
    ...(delta.enabled === undefined ? {} : { enabled: delta.enabled }),
    ...(delta.timeout_seconds === undefined
      ? {}
      : { timeout_seconds: delta.timeout_seconds }),
    ...(delta.schedule === undefined ? {} : { schedule: delta.schedule }),
    ...(delta.on_failure === undefined ? {} : { on_failure: delta.on_failure }),
    ...(env === undefined ? {} : { env }),
    ...(args === undefined ? {} : { args }),
  };
};

/** Inputs to {@link effectiveManifests}. */
export interface EffectiveManifestsInput {
  /** Core manifests ({@link readCoreManifests}). */
  manifests: readonly JobManifest[];
  /** The instance's `jobs` block from `jeeves-scripts.json`. */
  deltas: Readonly<Record<string, JobDelta>>;
  /** Every id a delta may name: core job ids plus instance job ids. */
  knownIds: ReadonlySet<string>;
}

/**
 * Core manifests with the instance's deltas applied.
 *
 * @throws When a delta names an unknown runnable id, or sets a runner field
 *   (`enabled`, `schedule`, `timeout_seconds`, `on_failure`, `env`, `args`) on a runnable
 *   with no manifest, where it would have no effect (listing every such id;
 *   Decision 58).
 */
export const effectiveManifests = ({
  manifests,
  deltas,
  knownIds,
}: EffectiveManifestsInput): JobManifest[] => {
  const unknown = Object.keys(deltas).filter((id) => !knownIds.has(id));
  if (unknown.length > 0)
    throw new Error(
      `jobs in jeeves-scripts.json names unknown runnable id(s): ${unknown.join(', ')}.`,
    );
  const withManifest = new Set(manifests.map((m) => m.id));
  const inert = Object.entries(deltas)
    .filter(
      ([id, delta]) =>
        !withManifest.has(id) &&
        RUNNER_FIELDS.some((field) => delta[field] !== undefined),
    )
    .map(([id]) => id);
  if (inert.length > 0)
    throw new Error(
      `jobs in jeeves-scripts.json sets ${RUNNER_FIELDS.join('/')} on runnable id(s) with no manifest, where they have no effect: ${inert.join(', ')}. Give the runnable a manifest, or remove those fields.`,
    );
  return manifests.map((m) => applyDelta(m, deltas[m.id]));
};
