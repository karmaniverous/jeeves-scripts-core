/**
 * @module cli/load-plugin
 *
 * Loads the instance plugin (Decision 49; design §3): `{root}/jeeves-scripts.plugin.ts`,
 * imported in the CLI's own process with tsx, so instance TypeScript runs
 * without a build step. A repo without the file has no plugin. When the
 * plugin declares a `configSchema`, the `local` block of the instance's
 * `jeeves-scripts.json` is parsed with it here, before any runnable runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';

import { getLoadedConfigPath, loadConfig } from '../config/loader.js';
import { isPlugin, type Plugin, setLocalConfig } from '../runnables/plugin.js';

/** The plugin file name, at the instance root (a fixed contract). */
export const PLUGIN_FILE = 'jeeves-scripts.plugin.ts';

/** Seams for tests. */
export interface LoadPluginDeps {
  /** Imports a TypeScript module (default: tsx's `tsImport`). */
  importTs: (url: string, parent: string) => Promise<unknown>;
}

const defaultDeps: LoadPluginDeps = {
  importTs: (url, parent) => tsImport(url, parent),
};

/**
 * Load `{root}/jeeves-scripts.plugin.ts`. Call after the config location
 * is pinned to the instance (`JEEVES_SCRIPTS_CONFIG`).
 *
 * @returns The plugin, or `undefined` when the instance has none.
 * @throws When the file fails to load, does not default-export
 *   `definePlugin(...)`, or its `configSchema` rejects the `local` block.
 */
export const loadPlugin = async (
  root: string,
  deps: LoadPluginDeps = defaultDeps,
): Promise<Plugin | undefined> => {
  const file = path.join(root, PLUGIN_FILE);
  if (!fs.existsSync(file)) return undefined;
  const mod = (await deps.importTs(
    pathToFileURL(file).href,
    import.meta.url,
  )) as { default?: unknown };
  if (!isPlugin(mod.default))
    throw new Error(`${PLUGIN_FILE} must default-export definePlugin(...).`);
  const plugin = mod.default;
  if (plugin.configSchema)
    setLocalConfig(
      plugin.configSchema,
      loadConfig().local,
      getLoadedConfigPath() ?? 'jeeves-scripts.json',
    );
  return plugin;
};
