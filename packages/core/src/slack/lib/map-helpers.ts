/**
 * @module slack/lib/map-helpers
 *
 * jeeves-watcher map helpers for indexed Slack messages (namespace
 * `slack` in the watcher's `mapHelpers`, pointing at this module's built
 * file `dist/slack/lib/map-helpers.js` in the instance's node_modules):
 *
 * - `resolveSlackUserEmails(ids)`: emails of Slack users, from the Slack
 *   user cache (`{stateDir}/slack/users.json`, re-read when it changes);
 * - `resolveSlackChannelMeta(id)`: what we decided about the channel
 *   (`slack.channels.<id>`: `project`, `homeDir`), or `{}`.
 *
 * The watcher runs outside the instance, so the config is found from
 * `JEEVES_SCRIPTS_CONFIG`, else the nearest `jeeves-scripts.json` above
 * this file (the instance root that installed the package).
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  CONFIG_PATH_ENV,
  getConfigRoot,
  getLoadedConfigPath,
  loadConfig,
  resetConfig,
} from '../../config/loader.js';
import { getChannelConfig } from './channel-config.js';
import { loadUserCache, type SlackUser, userCacheFile } from './slack-cache.js';

/** The nearest `jeeves-scripts.json` at or above `dir`, or undefined. */
export function findInstanceConfig(dir: string): string | undefined {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const candidate = path.join(d, 'jeeves-scripts.json');
    if (fs.existsSync(candidate)) return candidate;
    if (path.dirname(d) === d) return undefined;
  }
}

/** The loaded config file's mtime, to notice a `config set` (#62 review). */
let configMtimeMs: number | undefined;

/** A file's mtime, or undefined when it is gone. */
const mtimeOf = (file: string): number | undefined =>
  fs.existsSync(file) ? fs.statSync(file).mtimeMs : undefined;

/**
 * Load the instance config, wherever this module runs, and load it again
 * when its file changes: the watcher keeps this module loaded, and the
 * config is edited in place with `config set`.
 */
function ensureConfig(): void {
  const loaded = getLoadedConfigPath();
  if (loaded) {
    if (mtimeOf(loaded) === configMtimeMs) return;
    resetConfig();
  }
  if (process.env[CONFIG_PATH_ENV] || getConfigRoot()) loadConfig();
  else {
    const found = findInstanceConfig(import.meta.dirname);
    if (!found)
      throw new Error(
        `Cannot find jeeves-scripts.json above ${import.meta.dirname}; set ${CONFIG_PATH_ENV}.`,
      );
    loadConfig({ configPath: found });
  }
  const file = getLoadedConfigPath();
  configMtimeMs = file ? mtimeOf(file) : undefined;
}

let users: { mtimeMs: number; data: Record<string, SlackUser> } | undefined;

/** The user cache, re-read when the file changes. */
function currentUsers(): Record<string, SlackUser> {
  const file = userCacheFile();
  const mtimeMs = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  if (users?.mtimeMs !== mtimeMs)
    users = { mtimeMs, data: loadUserCache(file) };
  return users.data;
}

/** Emails of the given Slack user ids (unknown users contribute none). */
export function resolveSlackUserEmails(
  userIds: string | string[] | null | undefined,
): string[] {
  if (!userIds) return [];
  ensureConfig();
  const all = currentUsers();
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  return ids.flatMap((id) => all[id]?.emails ?? []);
}

/** The channel's `slack.channels` entry, or `{}`. */
export function resolveSlackChannelMeta(
  channelId: unknown,
): Record<string, unknown> {
  if (!channelId || typeof channelId !== 'string') return {};
  ensureConfig();
  return { ...getChannelConfig(channelId) };
}
