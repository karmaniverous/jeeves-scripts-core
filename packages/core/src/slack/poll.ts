#!/usr/bin/env tsx
/**
 * @module slack/poll
 *
 * Polls Slack channels for new messages across configured workspaces.
 *
 * Called by jeeves-runner on a schedule. Discovers the channels each bot
 * can read, fetches history and thread replies via the Slack API, and
 * writes individual JSON files per message to silo-routed directories.
 * Depends on constants().PRIMARY_WORKSPACE and constants().SLACK_DOMAIN_DIR;
 * a channel's workspace (for routing) is cached on its Slack cache entry
 * (lib/channel-workspace).
 *
 * Channel and user facts come from Slack and are cached in the state
 * folder (lib/slack-cache, refreshed by lib/slack-sync). Read positions
 * (newest `ts` per channel) are in the jeeves-runner state store
 * (lib/cursors); an unreachable store fails the run. Decisions about a
 * channel (project, home dir) are config: `slack.channels`.
 */

import fs from 'node:fs';

import { runScript } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { constants } from '../lib/constants.js';
import { resolveChannelDir } from './lib/channel-dir.js';
import type { ChannelInfo } from './lib/channel-info.js';
import {
  getTeamId,
  getTokens,
  resolveChannelToken,
} from './lib/channel-token.js';
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
  userMap: Record<string, string>,
  cursors: Cursors,
): Promise<number> {
  const channelDir = await resolveChannelDir(channelId, channelInfo, token);
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

async function pollAll(client: RunnerClient): Promise<void> {
  const tokensByAccount = getTokens();
  const accountNames = Object.keys(tokensByAccount);
  console.log(
    `Loaded ${String(accountNames.length)} Slack account(s): ${accountNames.join(', ')}`,
  );

  // Build teamId -> account mapping via auth.test
  const teamToAccount: Record<string, string> = {};
  for (const [account, token] of Object.entries(tokensByAccount)) {
    try {
      await sleep(RATE_LIMIT_MS);
      const teamId = await getTeamId(token);
      teamToAccount[teamId] = account;
      console.log(`Account "${account}" -> workspace ${teamId}`);
    } catch (err) {
      console.error(
        `Failed auth.test for account "${account}" (skipping): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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
      const token = await resolveChannelToken(
        id,
        info,
        tokensByAccount,
        teamToAccount,
      );
      const written = await pollChannel(id, info, token, userMap, cursors);
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

async function main(): Promise<void> {
  if (!fs.existsSync(constants().SLACK_DOMAIN_DIR)) {
    console.log('[skip] Slack domain directory not configured');
    return;
  }

  // Throws if the runner state store is not configured (JR_DB_PATH).
  const client = getRunnerClient();
  try {
    await pollAll(client);
  } finally {
    client.close();
  }
}

runScript('slack/poll', () => {
  main().catch((err: unknown) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
});
