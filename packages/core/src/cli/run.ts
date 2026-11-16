/**
 * @module cli/run
 *
 * `jeeves-scripts run <id> [args...]` (Decisions 16, 49; design §4): the
 * command runner jobs, webhooks and people run through the instance
 * launcher.
 *
 * Before resolving anything, the instance root is registered with the
 * config loader (`setConfigRoot`: `JEEVES_SCRIPTS_CONFIG` if set, else
 * `{root}/jeeves-scripts.json`, a pointer or a legacy full config; #57) and
 * the instance plugin is loaded and registered (`runnables/runnables`).
 * Resolution:
 *
 * 1. a plugin override for `<id>` runs instead of core's runnable;
 * 2. else a core id runs core's runnable from the registry;
 * 3. else a plugin runnable id runs the instance runnable;
 * 4. else an instance manifest entry with that id that sets `runnable` runs
 *    that runnable under the entry's id (Decision 80), checked as
 *    registration checks it;
 * 5. else `run` fails: unknown id.
 *
 * Every runnable runs in this process through `runJobModule`, with the
 * arguments after the id. A runnable that declares `flags` gets them
 * checked first (`runnables/job-help`): an undeclared option exits 1 before
 * the body runs. One that declares none gets them unchecked, with a
 * deprecation warning. `run <id> --help` is handled by `cli/list`
 * ({@link jobHelp}).
 */

import { loadConfig, setConfigRoot } from '../config/loader.js';
import type { JobModule } from '../runnables/define-runnable.js';
import { jobConfigError, jobConfigOrThrow } from '../runnables/job-config.js';
import { argsError, flagsDeprecation } from '../runnables/job-help.js';
import {
  checkJobEntry,
  manifestFile,
  noConfigSchemaProblem,
} from '../runnables/job-instances.js';
import type { RegistryEntry } from '../runnables/registry.js';
import { type RunJobDeps, runJobModule } from '../runnables/run-job.js';
import {
  buildRunnables,
  readInstanceManifests,
  type Runnable,
} from '../runnables/runnables.js';
import { loadPlugin } from './load-plugin.js';

/** Seams for tests. */
export interface RegisterOptions {
  /** Core's registry. Default: core's. */
  registry?: readonly RegistryEntry[];
  /** Loads the plugin. Default: {@link loadPlugin}. */
  loadPlugin?: typeof loadPlugin;
}

/**
 * Register the instance root with the config loader, load its plugin and register
 * every runnable.
 *
 * @throws When the plugin fails to load or breaks a registration rule.
 */
export const registerInstance = async (
  root: string,
  options: RegisterOptions = {},
): Promise<Runnable[]> => {
  setConfigRoot(root);
  const plugin = await (options.loadPlugin ?? loadPlugin)(root);
  return buildRunnables({ plugin, registry: options.registry });
};

const unknownRunnable = (id: string): Error =>
  new Error(
    `Unknown runnable "${id}": not a core runnable, not registered by jeeves-scripts.plugin.ts and not a job in jobs/*.json (see jeeves-scripts list).`,
  );

/** Seams for {@link runJob} tests. */
export interface RunOptions extends RegisterOptions {
  /** How the job runs. Default: `runJobModule`'s (`runScript`, the console). */
  runDeps?: RunJobDeps;
}

/**
 * The runnable `id` runs and the id of that runnable: a registered
 * runnable runs itself (a listed job, its `runnable`); a job in the
 * instance's manifests that sets `runnable` runs that one (Decision 80),
 * checked by registration's rules. `run` and `run <id> --help` resolve
 * through it.
 *
 * @throws On an unknown id, an invalid job entry or a job whose runnable
 *   declares no `configSchema`.
 */
export const resolveJob = async (
  root: string,
  runnables: readonly Runnable[],
  id: string,
): Promise<{ job: JobModule; runnableId: string }> => {
  const direct = runnables.find((r) => r.id === id);
  if (direct)
    return { job: await direct.load(), runnableId: direct.runnable ?? id };
  const entry = readInstanceManifests(root).find((m) => m.id === id);
  if (entry?.runnable === undefined) throw unknownRunnable(id);
  const file = manifestFile(entry);
  const check = checkJobEntry(
    id,
    entry.runnable,
    file,
    new Map(runnables.map((r) => [r.id, r])),
  );
  if ('problem' in check)
    throw new Error(`Invalid instance manifests:\n- ${check.problem}`);
  const job = await check.runnable.load();
  if (!job.configSchema)
    throw jobConfigError([noConfigSchemaProblem(file, id, entry.runnable)]);
  return { job, runnableId: entry.runnable };
};

/**
 * Run a runnable, or a job that runs one, in this process. Resolves to 0
 * when its body has finished or it skipped (a crash exits 1 through
 * `runScript`; a runnable may set `process.exitCode`), and to 1, without
 * running it, when it declares `flags` and `args` holds anything else.
 * The run gets `id` as `ctx.jobId` and the job's parsed config as
 * `ctx.config` (Decisions 79, 81).
 *
 * @throws On a registration error, an unknown id or an invalid job config
 *   (the runnable declares a `configSchema`), before anything runs.
 */
export const runJob = async (
  root: string,
  id: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<number> => {
  const runnables = await registerInstance(root, options);
  const { job, runnableId } = await resolveJob(root, runnables, id);
  const config = job.configSchema
    ? jobConfigOrThrow({
        jobId: id,
        runnableId,
        schema: job.configSchema,
        deltas: loadConfig().jobs,
      })
    : undefined;
  // Messages name the id that was run (`run <jobId> --help`).
  const named = { ...job, id };
  const error = argsError(named, args);
  if (error) {
    console.error(error);
    return 1;
  }
  const deprecation = flagsDeprecation(named, args);
  if (deprecation) console.warn(deprecation);
  await runJobModule(job, args, options.runDeps, { jobId: id, config });
  return 0;
};
