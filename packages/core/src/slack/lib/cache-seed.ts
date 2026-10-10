/**
 * @module slack/lib/cache-seed
 *
 * One-time switchover from the old Slack files to the Slack cache
 * (`jeeves-scripts slack seed-cache`): carry each channel's account
 * (`_account`, from the old committed `channels.json`) and workspace
 * (`teamId`, from the old `slack-channel-workspaces.json`) into
 * `{stateDir}/slack/channels.json`, so every channel keeps the token and
 * silo it had. A workspace looked up again today can differ from the
 * recorded one (e.g. DMs recorded under their own workspace, channels the
 * bot can no longer read), so the recorded values are kept rather than
 * rebuilt. Values already in the cache are never overwritten.
 */

import fs from 'node:fs';

import { z } from 'zod';

import type { ChannelInfo } from './channel-info.js';

const legacyChannelsSchema = z.record(
  z.string(),
  z.looseObject({
    name: z.string().optional(),
    type: z.string().optional(),
    _account: z.string().optional(),
  }),
);

const legacyWorkspacesSchema = z.record(z.string(), z.string());

/** What a seed run did. */
export interface SeedResult {
  added: number;
  accountsSet: number;
  teamsSet: number;
  kept: number;
}

/**
 * Seed `cache` (mutated) from the old files' contents. Channels missing
 * from the cache are added with the old name and type; a channel the old
 * files know nothing useful about is skipped.
 */
export function seedChannelCache(
  cache: Record<string, ChannelInfo>,
  legacyChannels: unknown,
  legacyWorkspaces: unknown,
): SeedResult {
  const channels = legacyChannelsSchema.parse(legacyChannels);
  const teams = legacyWorkspacesSchema.parse(legacyWorkspaces);
  const result: SeedResult = { added: 0, accountsSet: 0, teamsSet: 0, kept: 0 };
  for (const id of new Set([...Object.keys(channels), ...Object.keys(teams)])) {
    const old = channels[id];
    const team = teams[id];
    let entry = cache[id];
    if (!entry) {
      if (!old?.name) continue;
      entry = { name: old.name, type: old.type ?? 'channel' };
      cache[id] = entry;
      result.added++;
    }
    if (old?._account && !entry._account) {
      entry._account = old._account;
      result.accountsSet++;
    } else if (old?._account) result.kept++;
    if (team && !entry.teamId) {
      entry.teamId = team;
      result.teamsSet++;
    } else if (team) result.kept++;
  }
  return result;
}

/** Read a JSON file (UTF-8, BOM tolerated). */
export const readJsonFile = (file: string): unknown =>
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
