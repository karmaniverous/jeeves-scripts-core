/**
 * @module cli/run
 *
 * `jeeves-scripts run <job-id> [args...]` (Decision 16): the command runner
 * jobs execute through the instance launcher.
 *
 * Resolution (Decisions 4, 6, 27, 40):
 *
 * 1. A core job id resolves through the core job registry, always. An
 *    instance file never silently replaces a core job: an instance
 *    `jobs/*.json` entry that reuses a core id with a script present in the
 *    instance repo is an error. Instances change core jobs only through
 *    `jobs.<id>` deltas in `jeeves-scripts.json`, or (Dev Plan 33 phase 2)
 *    a declared override.
 * 2. Any other id must be declared by the instance in `{root}/jobs/*.json`
 *    with a `script` path (`src/<domain>/<name>.ts`). The instance file at
 *    that path runs. With no instance file, a script naming a core module
 *    runs that core job (transitional alias for runner job ids that differ
 *    from core's).
 *
 * Core jobs run in this process ({@link runJobModule}), after the config
 * location is pinned to the instance root, so they read the instance's
 * `jeeves-scripts.json`. Instance scripts are TypeScript and run in a child
 * `node --import tsx` process with the same environment.
 *
 * Job files are validated with Zod (Decision 31): a malformed entry fails
 * the run, naming its file and position, rather than being skipped.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { CONFIG_PATH_ENV } from '../config/loader.js';
import { runJobModule } from '../jobs/define-job.js';
import {
  coreJobs,
  findJob,
  findJobByScript,
  loadJob,
  type RegistryEntry,
} from '../jobs/registry.js';

/**
 * An instance runner job definition, as far as `run` needs it. Other
 * runner fields (`schedule`, `enabled`, `env`, ...) are allowed and
 * ignored here.
 */
export const jobDefinitionSchema = z.looseObject({
  /** Job id (`jeeves-scripts run <id>`). */
  id: z.string().min(1),
  /** Script path relative to the instance root, e.g. `src/acme/report.ts`. */
  script: z.string().min(1),
});

/** A `jobs/*.json` file: an array of job definitions. */
export const jobFileSchema = z.array(jobDefinitionSchema);

/** A validated instance runner job definition. */
export type JobDefinition = z.infer<typeof jobDefinitionSchema>;

/** Where a job's code lives. */
export type ResolvedJob =
  | { kind: 'core'; entry: RegistryEntry; alias?: JobDefinition }
  | { kind: 'instance'; job: JobDefinition; file: string };

/**
 * Every job the instance declares in `{root}/jobs/*.json`, in file-name
 * order.
 *
 * @throws When a file is not valid JSON or not an array of job
 *   definitions; the message names the file and the failing entry.
 */
export const readJobs = (root: string): JobDefinition[] => {
  const dir = path.join(root, 'jobs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      const result = jobFileSchema.safeParse(
        JSON.parse(fs.readFileSync(file, 'utf8')),
      );
      if (!result.success)
        throw new Error(
          `Invalid job file jobs/${name}: ${z.prettifyError(result.error)}`,
        );
      return result.data;
    });
};

/**
 * Resolve a job id (rules in the module doc).
 *
 * @param registry - Core job registry. Default: core's.
 * @throws When the id is unknown, when an instance file would replace a
 *   core job, or when an instance job's script exists nowhere.
 */
export const resolveJob = (
  root: string,
  jobId: string,
  registry: readonly RegistryEntry[] = coreJobs,
): ResolvedJob => {
  const declared = readJobs(root).find((j) => j.id === jobId);
  const core = findJob(jobId, registry);
  if (core) {
    if (declared && fs.existsSync(path.join(root, declared.script)))
      throw new Error(
        `Job "${jobId}" is a core job; the instance file ${declared.script} would replace it. ` +
          'Instances change core jobs only through jobs.<id> deltas in jeeves-scripts.json or a declared override (Decisions 6, 27). ' +
          'Give an instance-only job its own id.',
      );
    return { kind: 'core', entry: core };
  }
  if (!declared)
    throw new Error(
      `Unknown job "${jobId}": not a core job and not declared in the instance's jobs/*.json.`,
    );
  const local = path.join(root, declared.script);
  if (fs.existsSync(local))
    return { kind: 'instance', job: declared, file: local };
  const alias = findJobByScript(declared.script, registry);
  if (alias) return { kind: 'core', entry: alias, alias: declared };
  throw new Error(
    `Job "${jobId}": script ${declared.script} is neither in the instance repo nor a core job module.`,
  );
};

/**
 * Run a job. Core jobs run in this process and resolve when the job body
 * has finished (a crash exits 1 through `runScript`); instance scripts run
 * in a child process and resolve to its exit code.
 */
export const runJob = async (
  root: string,
  jobId: string,
  args: readonly string[],
  registry?: readonly RegistryEntry[],
): Promise<number> => {
  const resolved = resolveJob(root, jobId, registry);
  process.env[CONFIG_PATH_ENV] ??= path.join(root, 'jeeves-scripts.json');
  if (resolved.kind === 'instance') {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolved.file, ...args],
      { cwd: root, stdio: 'inherit', env: process.env },
    );
    return result.status ?? 1;
  }
  await runJobModule(await loadJob(resolved.entry), args);
  return 0;
};
