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
 * 4. else `run` fails: unknown id.
 *
 * Every runnable runs in this process through `runJobModule`, with the
 * arguments after the id. A runnable that declares `flags` gets them
 * checked first (`runnables/job-help`): an undeclared option exits 1 before
 * the body runs. One that declares none gets them unchecked, with a
 * deprecation warning. `run <id> --help` is handled by `cli/list`
 * ({@link jobHelp}).
 */

import { setConfigRoot } from '../config/loader.js';
import { runJobModule } from '../runnables/define-runnable.js';
import { argsError, flagsDeprecation } from '../runnables/job-help.js';
import type { RegistryEntry } from '../runnables/registry.js';
import { buildRunnables, type Runnable } from '../runnables/runnables.js';
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

/**
 * The registered runnable with this id.
 *
 * @throws When no runnable has it.
 */
export const resolveRunnable = (
  runnables: readonly Runnable[],
  id: string,
): Runnable => {
  const runnable = runnables.find((r) => r.id === id);
  if (!runnable)
    throw new Error(
      `Unknown runnable "${id}": not a core runnable and not registered by jeeves-scripts.plugin.ts (see jeeves-scripts list).`,
    );
  return runnable;
};

/**
 * Run a runnable in this process. Resolves to 0 when its body has finished
 * or it skipped (a crash exits 1 through `runScript`; a runnable may set
 * `process.exitCode`), and to 1, without running it, when it declares
 * `flags` and `args` holds anything else.
 *
 * @throws On a registration error or an unknown id, before anything runs.
 */
export const runJob = async (
  root: string,
  id: string,
  args: readonly string[],
  options: RegisterOptions = {},
): Promise<number> => {
  const runnable = resolveRunnable(await registerInstance(root, options), id);
  const job = await runnable.load();
  const error = argsError(job, args);
  if (error) {
    console.error(error);
    return 1;
  }
  const deprecation = flagsDeprecation(job, args);
  if (deprecation) console.warn(deprecation);
  await runJobModule(job, args);
  return 0;
};
