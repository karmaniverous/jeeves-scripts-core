#!/usr/bin/env tsx
/**
 * @module slack/poll
 *
 * Polls Slack channels for new messages across configured workspaces.
 *
 * Called by jeeves-runner on a schedule. Auto-discovers channels the bot
 * has joined, fetches history and thread replies via the Slack API, and
 * writes individual JSON files per message to silo-routed directories.
 * Depends on constants().PRIMARY_WORKSPACE, constants().SLACK_DOMAIN_DIR, and
 * constants().SLACK_WORKSPACE_CACHE_PATH from constants for workspace routing.
 *
 * Read positions (newest `ts` per channel) are instance state, kept in
 * the jeeves-runner state store (see lib/cursors.ts); `channels.json`
 * holds curated channel config only. An unreachable store fails the run.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript, saveCache } from '@karmaniverous/jeeves';
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
import {
  type Cursors,
  preparePollState,
  saveChannels,
  saveCursor,
} from './lib/cursors.js';
import { enrichFileContent } from './lib/file-content.js';
import { writeMessage } from './lib/message-writer.js';
import {
  discoverChannels,
  fetchHistory,
  fetchReplies,
  RATE_LIMIT_MS,
  sleep,
} from './lib/slack-api.js';

const CHANNELS_FILE = path.join(
  constants().SCRIPTS_DIR,
  'src/slack/lib/channels.json',
);
const USERS_FILE = path.join(
  constants().SCRIPTS_DIR,
  'src/slack/lib/users.json',
);

function loadUsers(): Record<string, string> {
  if (fs.existsSync(USERS_FILE)) {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) as Record<
      string,
      string
    >;
  }
  return {};
}

async function pollChannel(
  channelId: string,
  channelInfo: ChannelInfo,
  token: string,
  userMap: Record<string, string>,
  cursors: Cursors,
): Promise<number> {
  const channelDir = await resolveChannelDir(
    channelId,
    channelInfo.name,
    token,
  );
  const oldest = cursors[channelId] ?? '0';

  const { messages, newestTs } = await fetchHistory(channelId, oldest, token);

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

async function autoDiscover(
  channels: Record<string, ChannelInfo>,
  token: string,
  account: string,
): Promise<number> {
  const allChannels = await discoverChannels(token);
  let added = 0;

  for (const ch of allChannels) {
    if (!ch.is_member && !ch.is_im) continue;
    if (ch.id in channels) continue;

    const entry: ChannelInfo = {
      name: ch.name ?? (ch.is_im ? `dm-${ch.user ?? ch.id}` : `mpim-${ch.id}`),
      type: ch.is_im ? 'dm' : ch.is_mpim ? 'mpim' : 'channel',
      isPrivate: ch.is_private ?? ch.is_im ?? false,
      isArchived: false,
      metadata: {},
      _autoDiscovered: new Date().toISOString(),
      _account: account,
    };
    if (ch.is_ext_shared) entry.isSlackConnect = true;
    if (ch.shared_team_ids && ch.shared_team_ids.length > 1)
      entry.sharedTeams = ch.shared_team_ids;

    channels[ch.id] = entry;
    console.log(
      `DISCOVERED: ${ch.id} -> ${entry.name} (${entry.type}, account: ${account}${entry.isSlackConnect ? ', Slack Connect' : ''})`,
    );
    added++;
  }

  return added;
}

/** Auto-discover new channels for every account; returns the number added. */
async function discoverAll(
  channels: Record<string, ChannelInfo>,
  tokensByAccount: Record<string, string>,
): Promise<number> {
  let total = 0;
  for (const [account, token] of Object.entries(tokensByAccount)) {
    try {
      const discovered = await autoDiscover(channels, token, account);
      if (discovered > 0) {
        console.log(
          `Auto-discovered ${String(discovered)} new channel(s) for account "${account}"`,
        );
      }
      total += discovered;
    } catch (err) {
      console.error(
        `Channel discovery failed for account "${account}" (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return total;
}

async function pollAll(client: RunnerClient): Promise<void> {
  const tokensByAccount = getTokens();
  const accountNames = Object.keys(tokensByAccount);
  console.log(
    `Loaded ${String(accountNames.length)} Slack account(s): ${accountNames.join(', ')}`,
  );

  // Build teamId → account mapping via auth.test
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

  const channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8')) as Record<
    string,
    ChannelInfo
  >;
  const userMap = loadUsers();
  // Discover first, then load read positions from the runner state store
  // for the full channel set (migrating legacy lastTs values) before
  // anything rewrites channels.json.
  const { cursors, migrated } = await preparePollState(
    client,
    CHANNELS_FILE,
    channels,
    () => discoverAll(channels, tokensByAccount),
  );
  if (migrated > 0) {
    console.log(
      `Migrated ${String(migrated)} legacy read position(s) from channels.json to runner state`,
    );
  }

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

  // Persist channel config (never read positions), then workspace cache
  saveChannels(CHANNELS_FILE, channels);
  saveCache();

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
