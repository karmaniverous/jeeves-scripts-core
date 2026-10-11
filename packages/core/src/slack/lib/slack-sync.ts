/**
 * @module slack/lib/slack-sync
 *
 * Refresh the Slack cache (slack-cache) from Slack for slack/poll:
 * channels the bots can read (`conversations.list`, every run), channel
 * members (`conversations.members`, at most daily, only for channels
 * with new messages) and users (`users.list`, at most daily). A failed
 * refresh is logged and the cached values are kept.
 */

import type { ChannelInfo } from './channel-info.js';
import {
  discoverChannels,
  fetchMembers,
  fetchUsers,
  RATE_LIMIT_MS,
  type SlackApiUser,
  type SlackChannel,
  sleep,
} from './slack-api.js';
import {
  cacheWrittenAt,
  loadUserCache,
  saveUserCache,
  type SlackUser,
  userCacheFile,
} from './slack-cache.js';

/** Members and users are re-read from Slack after this long. */
export const SLACK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** The cache entry Slack's view of a channel implies. */
export const channelFromSlack = (
  ch: SlackChannel,
): Omit<ChannelInfo, '_account'> => ({
  name: ch.name ?? (ch.is_im ? `dm-${ch.user ?? ch.id}` : `mpim-${ch.id}`),
  type: ch.is_im ? 'dm' : ch.is_mpim ? 'mpim' : 'channel',
  isPrivate: ch.is_private ?? ch.is_im ?? false,
  isArchived: ch.is_archived ?? false,
  ...(ch.is_ext_shared ? { isSlackConnect: true } : {}),
  ...(ch.shared_team_ids && ch.shared_team_ids.length > 1
    ? { sharedTeams: ch.shared_team_ids }
    : {}),
});

/**
 * Fold one account's `conversations.list` into the cached channels:
 * readable channels (member, or a DM) are added, tagged with `account`,
 * and existing entries take Slack's current name and flags, keeping
 * their account, members and discovery time.
 *
 * @returns the number of channels added
 */
export function mergeDiscovered(
  channels: Record<string, ChannelInfo>,
  discovered: readonly SlackChannel[],
  account: string,
  now: Date = new Date(),
): number {
  let added = 0;
  for (const ch of discovered) {
    if (!ch.is_member && !ch.is_im) continue;
    const fresh = channelFromSlack(ch);
    const existing = channels[ch.id];
    if (existing) {
      delete existing.isSlackConnect;
      delete existing.sharedTeams;
      Object.assign(existing, fresh);
      continue;
    }
    channels[ch.id] = {
      ...fresh,
      _autoDiscovered: now.toISOString(),
      _account: account,
    };
    console.log(
      `DISCOVERED: ${ch.id} -> ${fresh.name} (${fresh.type}, account: ${account}${fresh.isSlackConnect ? ', Slack Connect' : ''})`,
    );
    added++;
  }
  return added;
}

/** Discover channels for every account; returns the number added. */
export async function discoverAll(
  channels: Record<string, ChannelInfo>,
  tokensByAccount: Record<string, string>,
  discover: (token: string) => Promise<SlackChannel[]> = discoverChannels,
): Promise<number> {
  let total = 0;
  for (const [account, token] of Object.entries(tokensByAccount)) {
    try {
      const added = mergeDiscovered(channels, await discover(token), account);
      if (added > 0)
        console.log(
          `Auto-discovered ${String(added)} new channel(s) for account "${account}"`,
        );
      total += added;
    } catch (err) {
      console.error(
        `Channel discovery failed for account "${account}" (non-fatal): ${errorText(err)}`,
      );
    }
  }
  return total;
}

/** The cache record for a `users.list` member. */
export const userFromSlack = (u: SlackApiUser): SlackUser => {
  const alias = [u.profile?.real_name, u.real_name, u.profile?.display_name]
    .map((n) => n?.trim())
    .find(Boolean);
  return {
    name: u.name ?? u.id,
    ...(alias ? { alias } : {}),
    emails: u.profile?.email ? [u.profile.email] : [],
    is_bot: u.is_bot ?? false,
  };
};

/**
 * The cached users, re-read from every account's workspace when the cache
 * is older than `maxAgeMs` (or missing). Users seen before but not
 * returned now are kept, so old messages still resolve.
 */
export async function refreshUsers(
  tokensByAccount: Record<string, string>,
  file: string = userCacheFile(),
  maxAgeMs: number = SLACK_CACHE_MAX_AGE_MS,
  list: (token: string) => Promise<SlackApiUser[]> = fetchUsers,
  now: number = Date.now(),
): Promise<Record<string, SlackUser>> {
  const users = loadUserCache(file);
  if (now - cacheWrittenAt(file) < maxAgeMs) return users;
  let refreshed = false;
  for (const [account, token] of Object.entries(tokensByAccount)) {
    try {
      for (const u of await list(token)) users[u.id] = userFromSlack(u);
      refreshed = true;
    } catch (err) {
      console.error(
        `User list failed for account "${account}" (non-fatal): ${errorText(err)}`,
      );
    }
  }
  if (refreshed) saveUserCache(users, file);
  return users;
}

/**
 * Re-read a channel's members when they are older than `maxAgeMs` (or
 * unknown). A failure (e.g. a missing scope) keeps the cached members.
 */
export async function refreshParticipants(
  channelId: string,
  info: ChannelInfo,
  token: string,
  maxAgeMs: number = SLACK_CACHE_MAX_AGE_MS,
  members: (id: string, token: string) => Promise<string[]> = fetchMembers,
  now: Date = new Date(),
): Promise<void> {
  const at = info.participantsAt ? Date.parse(info.participantsAt) : 0;
  if (now.getTime() - at < maxAgeMs) return;
  try {
    await sleep(RATE_LIMIT_MS);
    info.participants = await members(channelId, token);
    info.participantsAt = now.toISOString();
  } catch (err) {
    console.error(
      `Members of ${channelId} unavailable (non-fatal): ${errorText(err)}`,
    );
  }
}
