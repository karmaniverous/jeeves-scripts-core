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
 * (lib/cursors), saved after each message so a run killed mid-channel
 * resumes there; an unreachable store fails the run. A channel stops at
 * `slack.backfillBudgetSeconds` per run, so one backlog can't starve the
 * others; a channel with no read position starts `slack.newChannelLookbackDays`
 * back (unset: full history). Decisions about a
 * channel (project, home dir) are config: `slack.channels`.
 */

import fs from 'node:fs';

import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { loadConfig } from '../config/loader.js';
import type { SlackConfig } from '../config/slack-schema.js';
import { defineJob } from '../jobs/define-job.js';
import { constants } from '../lib/constants.js';
import { accountTeams } from './lib/account-teams.js';
import { resolveChannelDir } from './lib/channel-dir.js';
import type { ChannelInfo } from './lib/channel-info.js';
import { getTokens, resolveChannelToken } from './lib/channel-token.js';
import {
  CursorStoreError,
  loadPollCursors,
  saveCursor,
} from './lib/cursors.js';
import { enrichFileContent } from './lib/file-content.js';
import { writeMessage } from './lib/message-writer.js';
import {
  fetchHistoryPage,
  fetchReplies,
  RATE_LIMIT_MS,
  type SlackMessage,
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

/** How one run reads one channel. */
interface ChannelRun {
  channelId: string;
  channelInfo: ChannelInfo;
  token: string;
  teams: Record<string, string>;
  userMap: Record<string, string>;
  /** Where reading starts (exclusive): the read position, or the lookback. */
  oldest: string;
  /** Records a new read position (in `cursors` and runner state) at once. */
  advance: (ts: string) => void;
  /** Epoch ms after which no further message is started. */
  deadline: number;
  now: () => number;
}

/** Enrich a message's text-extractable files, then write it; true when new. */
async function writeOne(
  run: ChannelRun,
  channelDir: string,
  msg: SlackMessage,
): Promise<boolean> {
  if (msg.files && msg.files.length > 0)
    await enrichFileContent(msg, run.token);
  return writeMessage(
    channelDir,
    run.channelId,
    run.channelInfo,
    msg,
    run.userMap,
  );
}

/**
 * Read one channel oldest-first, a history page at a time, saving the read
 * position after each top-level message and its replies, so a run killed
 * mid-channel resumes where it stopped. Each page starts at the position
 * just saved, so nothing is fetched ahead of what is written. The position
 * is a top-level message's ts, never a reply's (a reply can be newer than
 * top-level messages not yet read). At the deadline no further message or
 * page is started (after at least one message, so a backlog always
 * progresses); `more` says the channel has unread history left.
 */
async function pollChannel(
  run: ChannelRun,
): Promise<{ written: number; more: boolean }> {
  const { channelId, channelInfo, token } = run;
  const channelDir = await resolveChannelDir(
    channelId,
    channelInfo,
    token,
    run.teams,
  );
  let written = 0;
  let started = 0;
  let position = run.oldest;
  for (;;) {
    const page = await fetchHistoryPage(channelId, position, token);
    if (started === 0 && page.messages.length > 0)
      await refreshParticipants(channelId, channelInfo, token);
    for (const msg of page.messages) {
      if (started > 0 && run.now() >= run.deadline)
        return { written, more: true };
      started++;
      if (await writeOne(run, channelDir, msg)) written++;
      if (msg.reply_count && msg.reply_count > 0)
        for (const reply of await fetchReplies(
          channelId,
          msg.ts,
          run.oldest,
          token,
        ))
          if (await writeOne(run, channelDir, reply)) written++;
      run.advance(msg.ts);
      position = msg.ts;
    }
    // An empty page can't move the position: stop rather than refetch it.
    if (!page.hasMore || page.messages.length === 0)
      return { written, more: false };
    if (run.now() >= run.deadline) return { written, more: true };
    await sleep(RATE_LIMIT_MS);
  }
}

/** A Slack ts `days` before `now` (epoch ms), never before the epoch. */
const tsDaysBefore = (now: number, days: number): string =>
  `${String(Math.max(0, Math.floor(now / 1000 - days * 86_400)))}.000000`;

/** A channel Slack no longer lets this bot see (left, deleted, closed DM). */
const isGone = (err: unknown): boolean =>
  err instanceof Error && /\bchannel_not_found\b/.test(err.message);

async function pollAll(
  client: RunnerClient,
  tokensByAccount: Record<string, string>,
  config: Pick<SlackConfig, 'backfillBudgetSeconds' | 'newChannelLookbackDays'>,
  now: () => number,
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
    const advance = (ts: string): void => {
      cursors[id] = ts;
      saveCursor(client, id, ts);
    };
    const lookback = config.newChannelLookbackDays;
    let oldest = cursors[id];
    if (oldest === undefined && lookback !== undefined) {
      // Seed the position where the channel was first seen, so a quiet
      // channel keeps that start instead of sliding forward every run and
      // skipping what was posted between runs. A store failure aborts.
      oldest = tsDaysBefore(now(), lookback);
      advance(oldest);
    }
    try {
      const token = await resolveChannelToken(id, info, tokensByAccount, teams);
      const { written, more } = await pollChannel({
        channelId: id,
        channelInfo: info,
        token,
        teams,
        userMap,
        oldest: oldest ?? '0',
        advance,
        deadline: now() + config.backfillBudgetSeconds * 1000,
        now,
      });
      if (written > 0) {
        console.log(`${id} (${info.name}): ${String(written)} new`);
        totalWritten += written;
      }
      if (more)
        console.log(
          `backfilling ${id} (${info.name}): ${String(written)} written, resuming next run`,
        );
    } catch (err) {
      // A store failure aborts the run instead of being swallowed.
      if (err instanceof CursorStoreError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (isGone(err)) console.warn(`SKIP ${id}: ${msg}`);
      else console.error(`ERROR ${id}: ${msg}`);
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
  /** The `slack` config block (backfill budget, new-channel lookback). */
  config: () => Pick<
    SlackConfig,
    'backfillBudgetSeconds' | 'newChannelLookbackDays'
  >;
  /** The clock (epoch ms). */
  now: () => number;
}

/** The live collaborators, from config. */
export const slackPollDeps = (): SlackPollDeps => ({
  slackDir: constants().SLACK_DOMAIN_DIR,
  tokens: getTokens,
  runner: () => getRunnerClient(),
  config: () => loadConfig().slack,
  now: Date.now,
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
    await pollAll(client, deps.tokens(), deps.config(), deps.now);
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'slack-poll',
  domain: 'slack',
  flags: {},
  name: 'slack/poll',
  run: () => pollSlack(slackPollDeps()),
});
