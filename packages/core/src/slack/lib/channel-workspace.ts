/**
 * @module slack/lib/channel-workspace
 *
 * Which Slack workspace (team id) a channel belongs to, for token
 * resolution and silo routing. The answer is a fact from Slack, so it is
 * kept with the other channel facts in the Slack cache
 * (`{stateDir}/slack/channels.json`, entry field `teamId`), looked up
 * once per channel and reused (Decision 9).
 *
 * The rule (`conversations.info`):
 * - a channel with `shared_team_ids` belongs to the primary workspace
 *   when that is among them, else to the first of them (as jeeves'
 *   `getChannelWorkspace` decided);
 * - a channel without them (DMs and MPIMs never have them) or that
 *   cannot be read belongs to the workspace of the bot account that reads
 *   it (account-teams). DMs and MPIMs always take that workspace, even
 *   over a cached value: the old rule put them in the primary workspace,
 *   which archived other workspaces' DMs in the primary silo.
 *
 * The primary workspace is the `default` account's (account-teams).
 */

import { primaryTeam } from './account-teams.js';
import type { ChannelInfo } from './channel-info.js';
import { slackApi } from './slack-api.js';

/** True for a DM or MPIM (no `shared_team_ids`; owned by the reading account's workspace). */
export const isDirectMessage = (info: Pick<ChannelInfo, 'type'>): boolean =>
  info.type === 'dm' || info.type === 'mpim';

/**
 * Ask Slack which workspace owns `channelId` (rule in the module doc).
 * Never throws: an unreadable channel belongs to `accountTeam`.
 */
export async function queryChannelTeam(
  channelId: string,
  token: string,
  primaryWorkspace: string,
  accountTeam: string = primaryWorkspace,
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
    if (first === undefined) return accountTeam;
    return shared.includes(primaryWorkspace) ? primaryWorkspace : first;
  } catch {
    return accountTeam;
  }
}

/**
 * The channel's workspace, recorded on its Slack cache entry (the poller
 * saves the cache): a DM's or MPIM's is the reading account's; otherwise
 * the cached `teamId`, else looked up with `token`.
 *
 * @param teams - Account → team (account-teams).
 * @param account - The account reading the channel (default: the entry's `_account`, else `default`).
 */
export async function channelTeamId(
  channelId: string,
  info: ChannelInfo,
  token: string,
  teams: Record<string, string>,
  account: string = info._account ?? 'default',
): Promise<string> {
  const primary = primaryTeam(teams);
  const accountTeam = teams[account] ?? primary;
  if (isDirectMessage(info) && accountTeam) {
    info.teamId = accountTeam;
    return accountTeam;
  }
  if (info.teamId) return info.teamId;
  const teamId = await queryChannelTeam(channelId, token, primary, accountTeam);
  info.teamId = teamId;
  return teamId;
}
