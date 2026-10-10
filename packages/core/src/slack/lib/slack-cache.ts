/**
 * @module slack/lib/slack-cache
 *
 * The Slack cache: what Slack told us about channels and users, kept so
 * the poller and watcher helpers need not ask again on every run (Slack
 * rate limits). It is state, not config: it lives in
 * `{stateDir}/slack/` (`channels.json`, `users.json`), outside the repo,
 * and is rebuilt from Slack when missing. Read positions are not here;
 * they are in the runner state store (cursors).
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { paths } from '../../config/paths.js';
import type { ChannelInfo } from './channel-info.js';

/** The Slack cache directory: `{stateDir}/slack`. */
export const slackCacheDir = (): string => path.join(paths().stateDir, 'slack');

/** The channel cache file. */
export const channelCacheFile = (): string =>
  path.join(slackCacheDir(), 'channels.json');

/** The user cache file. */
export const userCacheFile = (): string =>
  path.join(slackCacheDir(), 'users.json');

const channelInfoSchema = z.looseObject({
  name: z.string(),
  type: z.string(),
  isPrivate: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isSlackConnect: z.boolean().optional(),
  sharedTeams: z.array(z.string()).optional(),
  participants: z.array(z.string()).optional(),
  participantsAt: z.string().optional(),
  _autoDiscovered: z.string().optional(),
  _account: z.string().optional(),
  teamId: z.string().optional(),
});

/** A cached Slack user. */
export const slackUserSchema = z.object({
  /** Handle. */
  name: z.string(),
  /** Real name, else display name. */
  alias: z.string().optional(),
  /** Profile email (needs the `users:read.email` scope). */
  emails: z.array(z.string()),
  is_bot: z.boolean(),
});

/** A cached Slack user. */
export type SlackUser = z.infer<typeof slackUserSchema>;

/** Read a JSON cache file; `{}` when missing or not valid (it is rebuilt from Slack). */
function readCache<S extends z.ZodType>(
  file: string,
  schema: S,
): z.output<S> | Record<string, never> {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Write a JSON cache file, creating the directory. */
function writeCache(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** The cached channels, by id. */
export const loadChannelCache = (
  file: string = channelCacheFile(),
): Record<string, ChannelInfo> =>
  readCache(file, z.record(z.string(), channelInfoSchema));

/** Save the cached channels. */
export const saveChannelCache = (
  channels: Record<string, ChannelInfo>,
  file: string = channelCacheFile(),
): void => {
  writeCache(file, channels);
};

/** The cached users, by id. */
export const loadUserCache = (
  file: string = userCacheFile(),
): Record<string, SlackUser> =>
  readCache(file, z.record(z.string(), slackUserSchema));

/** Save the cached users. */
export const saveUserCache = (
  users: Record<string, SlackUser>,
  file: string = userCacheFile(),
): void => {
  writeCache(file, users);
};

/** When a cache file was last written (epoch ms), or 0 when it does not exist. */
export const cacheWrittenAt = (file: string): number =>
  fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;

/** A user's display name: alias (real name), else handle. */
export const userDisplayName = (user: SlackUser): string =>
  [user.alias?.trim(), user.name].find(Boolean) ?? user.name;

/** User id → display name, for message files. */
export const userNames = (
  users: Record<string, SlackUser>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(users).map(([id, u]) => [id, userDisplayName(u)]),
  );
