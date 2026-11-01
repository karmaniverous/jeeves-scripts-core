/**
 * @module cli/config-check
 *
 * `jeeves-scripts config check` (Decisions 54, 57): the core checks of
 * `config/check` (schema, secret guard, silo references), then the
 * instance plugin, loaded and registered as `list` registers it: its
 * `configSchema` validates the `local` block, and registration checks the
 * plugin's runnables against core (unique ids, the naming rule, no core
 * domain; R45), the instance manifests, and the `jobs` deltas (no unknown
 * id; R16). Any failure is reported like any other config error. Reads the
 * config file, the manifests and imports the plugin; never throws.
 */

import { configCheck, type ConfigCheckResult } from '../config/check.js';
import { CONFIG_PATH_ENV } from '../config/loader.js';
import { type ListOptions, registerWithManifests } from './list.js';
import { loadPlugin } from './load-plugin.js';
import type { RegisterOptions } from './run.js';

/** Seams for tests. */
export interface InstanceConfigCheckDeps extends RegisterOptions {
  /** Core's manifests. Default: core's shipped `jobs/`. */
  coreManifests?: ListOptions['coreManifests'];
  /** Loads the plugin. Default: {@link loadPlugin}. */
  loadPlugin: typeof loadPlugin;
}

/**
 * Check an instance's config, including its `local` block,
 * its plugin's registration, its manifests and its deltas. The plugin is
 * loaded only when the core checks pass (it parses `local` from the config
 * they loaded), after `JEEVES_SCRIPTS_CONFIG` is set to the checked file,
 * as `run` and `list` pin it: modules the plugin imports resolve the same
 * file.
 *
 * @param root - Instance repo root.
 * @param configPath - Explicit config file (`--config`), else resolved
 *   from `JEEVES_SCRIPTS_CONFIG` or the root.
 */
export const instanceConfigCheck = async (
  root: string,
  configPath?: string,
  deps: InstanceConfigCheckDeps = { loadPlugin },
): Promise<ConfigCheckResult> => {
  const result = configCheck({ root, configPath });
  if (!result.ok) return result;
  if (result.configPath) process.env[CONFIG_PATH_ENV] = result.configPath;
  try {
    await registerWithManifests(root, deps);
  } catch (e) {
    return {
      ok: false,
      configPath: result.configPath,
      source: result.source,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
  return result;
};
