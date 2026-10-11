/**
 * @module cli/config-check
 *
 * `jeeves-scripts config check` (Decision 54): the core checks of
 * `config/check` (schema, secret guard, silo references), then the
 * instance plugin, loaded as `list` and `run` load it, so its
 * `configSchema` validates the `local` block. A plugin that fails to load
 * or rejects `local` is reported like any other config error. Reads the
 * config file and imports the plugin; never throws.
 */

import { configCheck, type ConfigCheckResult } from '../config/check.js';
import { CONFIG_PATH_ENV } from '../config/loader.js';
import { loadPlugin } from './load-plugin.js';

/** Seams for tests. */
export interface InstanceConfigCheckDeps {
  /** Loads the plugin. Default: {@link loadPlugin}. */
  loadPlugin: typeof loadPlugin;
}

/**
 * Check an instance's `jeeves-scripts.json`, including its `local` block.
 * The plugin is loaded only when the core checks pass (it parses `local`
 * from the config they loaded), after `JEEVES_SCRIPTS_CONFIG` is set to
 * the checked file, as `run` and `list` pin it: modules the plugin
 * imports resolve the same file.
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
    await deps.loadPlugin(root);
  } catch (e) {
    return {
      ok: false,
      configPath: result.configPath,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
  return result;
};
