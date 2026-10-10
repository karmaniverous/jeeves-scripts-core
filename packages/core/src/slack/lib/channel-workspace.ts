/**
 * @module slack/lib/channel-workspace
 *
 * Which Slack workspace (team id) a channel belongs to, for token
 * resolution and silo routing. The answer is a fact from Slack, so it is
 * kept with the other channel facts in the Slack cache
 * (`{stateDir}/slack/channels.json`, entry field `teamId`), looked up
 * once per channel and reused (Decision 9). This replaces the separate
 * `{configDir}/slack-channel-workspaces.json` that jeeves'
 * `getChannelWorkspace` kept.
 *
 * The lookup is the one `getChannelWorkspace` made, unchanged, so every
 * channel resolves to the same workspace as before:
 * `conversations.info`; when the channel has `shared_team_ids` that do
 * not include the primary workspace, the first of them; otherwise (and
 * on any error) the primary workspace.
 */

import { constants } from '../../lib/constants.js';
import type { ChannelInfo } from './channel-info.js';
import { slackApi } from './slack-api.js';

/**
 * Ask Slack which workspace owns `channelId` (rule in the module doc).
 * Never throws: an unreadable channel belongs to `primaryWorkspace`.
 */
export async function queryChannelTeam(
  channelId: string,
  token: string,
  primaryWorkspace: string,
): Promise<string> {
  try {
    const resp = await slackApi(
      'conversations.info',
      { channel: channelId },
      token,
    );
    const shared =
      (resp.channel as { shared_team_ids?: string[] } | undefined)
        ?.shared_team_ids ?? [];
    const first = shared[0];
    return first !== undefined && !shared.includes(primaryWorkspace)
      ? first
      : primaryWorkspace;
  } catch {
    return primaryWorkspace;
  }
}

/**
 * The channel's workspace: the cached `teamId` on its Slack cache entry,
 * else looked up with `token` and recorded on the entry (the poller saves
 * the cache).
 */
export async function channelTeamId(
  channelId: string,
  info: ChannelInfo,
  token: string,
  primaryWorkspace: string = constants().PRIMARY_WORKSPACE,
): Promise<string> {
  if (info.teamId) return info.teamId;
  const teamId = await queryChannelTeam(channelId, token, primaryWorkspace);
  info.teamId = teamId;
  return teamId;
}
