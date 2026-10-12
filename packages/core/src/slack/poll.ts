/**
 * @module slack/poll
 *
 * Polls Slack channels for new messages across configured workspaces.
 *
 * Called by jeeves-runner on a schedule. Discovers the channels each bot
 * can read, fetches history and thread replies via the Slack API, and
 * writes individual JSON files per message to silo-routed directories.
 * Skips when `SLACK_DOMAIN_DIR` does not exist; each account's workspace
 * (lib/account-teams) and each channel's (lib/channel-workspace) are
 * cached in the Slack cache.
 *
 * Channel and user facts come from Slack and are cached in the state
 * folder (lib/slack-cache, refreshed by lib/slack-sync). Read positions
 * (newest `ts` per channel) are in the jeeves-runner state store
 * (lib/cursors); an unreachable store fails the run. Decisions about a
 * channel (project, home dir) are config: `slack.channels`.
 */

import fs from 'node:fs';

import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { defineJob } from '../jobs/define-job.js';
import { constants } from '../lib/constants.js';
import { accountTeams } from './lib/account-teams.js';
import { resolveChannelDir } from './lib/channel-dir.js';
import type { ChannelInfo } from './lib/channel-info.js';
import { getTokens, resolveChannelToken } from './lib/channel-token.js';
import { type Cursors, loadPollCursors, saveCursor } from './lib/cursors.js';
import { enrichFileContent } from './lib/file-content.js';
import { writeMessage } from './lib/message-writer.js';
import {
  fetchHistory,
  fetchReplies,
  RATE_LIMIT_MS,
  sleep,
} from './lib/slack-api.js';
import {
  loadChannelCache,
  saveChannelCache,
  userNames,
} from './lib/slack-cache.js';
import {
  discoverAll,
  refreshParticipants,
  refreshUsers,
} from './lib/slack-sync.js';

async function pollChannel(
  channelId: string,
  channelInfo: ChannelInfo,
  token: string,
  teams: Record<string, string>,
  userMap: Record<string, string>,
  cursors: Cursors,
): Promise<number> {
  const channelDir = await resolveChannelDir(
    channelId,
    channelInfo,
    token,
    teams,
  );
  const oldest = cursors[channelId] ?? '0';

  const { messages, newestTs } = await fetchHistory(channelId, oldest, token);
  if (messages.length > 0)
    await refreshParticipants(channelId, channelInfo, token);

  let written = 0;
  let maxTs = newestTs;

  for (const msg of messages) {
    // Enrich text-extractable file attachments before writing
    if (msg.files && msg.files.length > 0) {
      await enrichFileContent(msg, token);
    }
    if (writeMessage(channelDir, channelId, channelInfo, msg, userMap)) {
      written++;
    }
    if (msg.ts > maxTs) maxTs = msg.ts;

    // Fetch thread replies
    if (msg.reply_count && msg.reply_count > 0) {
      const replies = await fetchReplies(channelId, msg.ts, oldest, token);
      for (const reply of replies) {
        if (reply.files && reply.files.length > 0) {
          await enrichFileContent(reply, token);
        }
        if (writeMessage(channelDir, channelId, channelInfo, reply, userMap)) {
          written++;
        }
        if (reply.ts > maxTs) maxTs = reply.ts;
      }
    }
  }

  if (maxTs > oldest) {
    cursors[channelId] = maxTs;
  }

  return written;
}

async function pollAll(
  client: RunnerClient,
  tokensByAccount: Record<string, string>,
): Promise<void> {
  const accountNames = Object.keys(tokensByAccount);
  console.log(
    `Loaded ${String(accountNames.length)} Slack account(s): ${accountNames.join(', ')}`,
  );

  // Each account's workspace (auth.test, cached in state).
  const teams = await accountTeams(tokensByAccount);
  for (const [account, teamId] of Object.entries(teams))
    console.log(`Account "${account}" -> workspace ${teamId}`);

  const channels = loadChannelCache();
  await discoverAll(channels, tokensByAccount);
  saveChannelCache(channels);
  const userMap = userNames(await refreshUsers(tokensByAccount));
  // Read positions for the full channel set, after discovery.
  const cursors = loadPollCursors(client, Object.keys(channels));

  let totalWritten = 0;

  for (const [id, info] of Object.entries(channels)) {
    await sleep(RATE_LIMIT_MS);
    const before = cursors[id];
    try {
      const token = await resolveChannelToken(id, info, tokensByAccount, teams);
      const written = await pollChannel(
        id,
        info,
        token,
        teams,
        userMap,
        cursors,
      );
      if (written > 0) {
        console.log(`${id} (${info.name}): ${String(written)} new`);
        totalWritten += written;
      }
    } catch (err) {
      console.error(
        `ERROR ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Persist an advanced read position at once (outside the per-channel
    // catch: a store failure aborts the run instead of being swallowed).
    const after = cursors[id];
    if (after !== undefined && after !== before) {
      saveCursor(client, id, after);
    }
  }

  // Persist the channel cache (accounts, workspaces and members learned).
  saveChannelCache(channels);

  if (totalWritten > 0) {
    console.log(`Total: ${String(totalWritten)} new messages`);
  }
}

/** What {@link pollSlack} reads and calls (Slack itself is reached over `fetch`). */
export interface SlackPollDeps {
  /** `SLACK_DOMAIN_DIR`; the job skips when it does not exist. */
  slackDir: string;
  /** Bot tokens by account. */
  tokens: () => Record<string, string>;
  /** Runner state (read positions). */
  runner: () => RunnerClient;
}

/** The live collaborators, from config. */
export const slackPollDeps = (): SlackPollDeps => ({
  slackDir: constants().SLACK_DOMAIN_DIR,
  tokens: getTokens,
  runner: () => getRunnerClient(),
});

/** Poll every readable channel of every account. */
export async function pollSlack(deps: SlackPollDeps): Promise<void> {
  if (!fs.existsSync(deps.slackDir)) {
    console.log('[skip] Slack domain directory not configured');
    return;
  }

  // Throws if the runner state store is not configured (JR_DB_PATH).
  const client = deps.runner();
  try {
    await pollAll(client, deps.tokens());
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'slack-poll',
  domain: 'slack',
  name: 'slack/poll',
  run: () => pollSlack(slackPollDeps()),
});
