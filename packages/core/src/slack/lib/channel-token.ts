/**
 * @module slack/lib/channel-token
 *
 * Which gateway Slack account's bot token reads a channel, for slack/poll:
 * the account tagged on the channel, else a workspace in its
 * `sharedTeams`, else the account of the channel's workspace
 * (channel-workspace, looked up with the first token), else that first
 * token. Tags the resolved account on the channel entry (`_account`) so
 * later runs skip the lookup.
 */

import { slackBotTokens } from '../../lib/openclaw-config.js';
import type { ChannelInfo } from './channel-info.js';
import { channelTeamId } from './channel-workspace.js';
import { RATE_LIMIT_MS, slackApi, sleep } from './slack-api.js';

/** Bot tokens by gateway Slack account: `SLACK_BOT_TOKEN` as `default`, else the OpenClaw config. */
export function getTokens(): Record<string, string> {
  if (process.env.SLACK_BOT_TOKEN)
    return { default: process.env.SLACK_BOT_TOKEN };
  return slackBotTokens();
}

/** The workspace (team) id a bot token belongs to (`auth.test`); throws when Slack returns none. */
export async function getTeamId(token: string): Promise<string> {
  const resp = await slackApi('auth.test', {}, token);
  if (!resp.team_id || typeof resp.team_id !== 'string') {
    throw new Error(
      `auth.test did not return a valid team_id (got ${JSON.stringify(resp.team_id)})`,
    );
  }
  return resp.team_id;
}

/**
 * The bot token to read `channelId` with (resolution order in the module
 * doc). Sets `channelInfo._account` when it resolves an account.
 *
 * @throws When no token exists at all.
 */
export async function resolveChannelToken(
  channelId: string,
  channelInfo: ChannelInfo,
  tokensByAccount: Record<string, string>,
  teamToAccount: Record<string, string>,
): Promise<string> {
  // 1. Explicit account tag from prior discovery or resolution
  const tagged = channelInfo._account
    ? tokensByAccount[channelInfo._account]
    : undefined;
  if (tagged) return tagged;

  // 2. Check sharedTeams metadata against known workspaces
  if (channelInfo.sharedTeams) {
    for (const teamId of channelInfo.sharedTeams) {
      const account = teamToAccount[teamId];
      if (account && tokensByAccount[account]) {
        channelInfo._account = account;
        return tokensByAccount[account];
      }
    }
  }

  // 3. The account of the channel's workspace, looked up with the first
  // token. The lookup never fails (an unreadable channel belongs to the
  // primary workspace), so this is the last step whenever a token exists.
  const first = Object.entries(tokensByAccount)[0];
  if (first === undefined)
    throw new Error(`No Slack token available for channel ${channelId}.`);
  const [account, token] = first;
  if (!channelInfo.teamId) await sleep(RATE_LIMIT_MS);
  const teamId = await channelTeamId(channelId, channelInfo, token);
  const resolvedAccount = teamToAccount[teamId] ?? account;
  channelInfo._account = resolvedAccount;
  return tokensByAccount[resolvedAccount] ?? token;
}
