/**
 * @module config/readable-config
 *
 * The instance config for an opt-in runnable's settings, or why there is
 * none to read, so the runnable can skip cleanly (Decision 58: run from
 * the registry with no loadable config, it logs one `[skip]` line and
 * exits 0). Used by `slack-refresh-channel-meta` and
 * `admin-review-skill-proposals`.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import { getLoadedConfigPath, loadConfig, resolveConfig } from './loader.js';
import type { Config } from './schema.js';

/**
 * The instance config, or why there is none to read: no config can be
 * located or read (no pointer, environment or repo file; a pointer to a
 * missing file). A config that is found but invalid throws (Decision 76:
 * an invalid config, the runnable's own block included, fails the run).
 *
 * @returns The config, or `{ skip }` with the reason.
 * @throws When a config is found but invalid.
 */
export const readableConfig = (): Config | { skip: string } => {
  if (getLoadedConfigPath() === null)
    try {
      resolveConfig();
    } catch (e) {
      return { skip: `no loadable instance config (${getErrorMessage(e)})` };
    }
  return loadConfig();
};
