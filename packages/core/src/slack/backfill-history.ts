/**
 * @module slack/backfill-history
 *
 * Re-read a Slack channel's history from its first message up to a bound
 * (`--before`; default: the oldest message already archived for the
 * channel), writing with the same writer as `slack-poll` (#50). It never
 * touches the poller's read position. A run stops at
 * `slack.backfillBudgetSeconds`; its progress is kept in runner state
 * (`slack-backfill` / `<channel>`) so rerunning resumes, and is cleared
 * when the channel is done. Files dedupe by `ts`, so re-reading is safe.
 * On demand only (no manifest).
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { loadConfig } from '../config/loader.js';
import type { SlackConfig } from '../config/slack-schema.js';
import { argOptional, type ParsedArgs } from '../lib/args.js';
import { constants } from '../lib/constants.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { accountTeams } from './lib/account-teams.js';
import { resolveChannelDir } from './lib/channel-dir.js';
import { getTokens, resolveChannelToken } from './lib/channel-token.js';
import { pollChannel } from './lib/read-channel.js';
import { HISTORY_FLOOR } from './lib/slack-api.js';
import {
  loadChannelCache,
  loadUserCache,
  userNames,
} from './lib/slack-cache.js';

/** Runner state namespace for backfill progress. */
export const BACKFILL_STATE_NAMESPACE = 'slack-backfill';

/** The runnable's flags. */
export const backfillFlags = {
  channel: argOptional('--channel', {
    description: 'Slack channel id to re-read (required)',
  }),
  before: argOptional('--before', {
    description:
      'Read up to this ts (default: the oldest message archived for the channel); restarts a resumed backfill',
  }),
};

/** Saved progress: the bound and the newest top-level ts written. */
interface Progress {
  before: string;
  position: string;
}

/** What {@link backfillHistory} reads and calls (Slack itself over `fetch`). */
export interface SlackBackfillDeps {
  /** Bot tokens by account. */
  tokens: () => Record<string, string>;
  /** Runner state (backfill progress). */
  runner: () => RunnerClient;
  /** The `slack` config block (per-channel budget). */
  config: () => Pick<SlackConfig, 'backfillBudgetSeconds'>;
  /** The clock (epoch ms). */
  now: () => number;
}

/** The live collaborators, from config. */
export const slackBackfillDeps = (): SlackBackfillDeps => ({
  tokens: getTokens,
  runner: () => getRunnerClient(),
  config: () => loadConfig().slack,
  now: Date.now,
});

/** The oldest archived message ts in `dir` (`{ts}.json` files), if any. */
export const oldestArchivedTs = (dir: string): string | undefined =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^\d+\.\d+\.json$/.test(f))
        .map((f) => path.basename(f, '.json'))
        .sort()[0]
    : undefined;

const readProgress = (
  client: RunnerClient,
  channelId: string,
): Progress | undefined => {
  const raw = client.getState(BACKFILL_STATE_NAMESPACE, channelId);
  return raw ? (JSON.parse(raw) as Progress) : undefined;
};

/**
 * Re-read one channel up to its bound, resuming saved progress.
 *
 * @throws When `--channel` is missing or unknown to the channel cache, or
 *   no bound is given and nothing is archived for the channel.
 */
export async function backfillHistory(
  flags: Partial<ParsedArgs<typeof backfillFlags>>,
  deps: SlackBackfillDeps,
): Promise<void> {
  const channelId = flags.channel;
  if (!channelId) throw new Error('--channel <id> is required');
  const info = loadChannelCache()[channelId];
  if (!info)
    throw new Error(
      `Channel ${channelId} is not in the Slack channel cache; run slack-poll first`,
    );

  const tokens = deps.tokens();
  const teams = await accountTeams(tokens);
  const token = await resolveChannelToken(channelId, info, tokens, teams);
  const channelDir = await resolveChannelDir(channelId, info, token, teams);

  const client = deps.runner();
  try {
    const saved = flags.before ? undefined : readProgress(client, channelId);
    const before =
      flags.before ?? saved?.before ?? oldestArchivedTs(channelDir);
    if (!before)
      throw new Error(
        `Nothing archived for ${channelId} in ${channelDir}; pass --before <ts>`,
      );
    const start = saved?.position ?? HISTORY_FLOOR;
    console.log(
      `[slack-backfill] ${channelId} (${info.name}): from ${start} up to ${before}`,
    );

    const { written, more } = await pollChannel({
      channelId,
      channelInfo: info,
      token,
      teams,
      userMap: userNames(loadUserCache()),
      oldest: start,
      before,
      advance: (ts) => {
        client.setState(
          BACKFILL_STATE_NAMESPACE,
          channelId,
          JSON.stringify({ before, position: ts } satisfies Progress),
        );
      },
      deadline: deps.now() + deps.config().backfillBudgetSeconds * 1000,
      now: deps.now,
    });

    if (more) {
      // Keep the bound even if no message was written this run.
      if (!readProgress(client, channelId))
        client.setState(
          BACKFILL_STATE_NAMESPACE,
          channelId,
          JSON.stringify({ before, position: start } satisfies Progress),
        );
      console.log(
        `[slack-backfill] ${channelId}: ${String(written)} written, rerun to resume`,
      );
    } else {
      client.deleteState(BACKFILL_STATE_NAMESPACE, channelId);
      console.log(
        `[slack-backfill] ${channelId}: done, ${String(written)} written`,
      );
    }
  } finally {
    client.close();
  }
}

export default defineRunnable({
  id: 'slack-backfill-history',
  domain: 'slack',
  name: 'slack/backfill-history',
  description:
    "Re-read a Slack channel from its first message up to --before (default: the oldest archived message); resumable, never moves slack-poll's read position",
  flags: backfillFlags,
  run: async ({ flags }) => {
    if (!fs.existsSync(constants().SLACK_DOMAIN_DIR)) {
      console.log('[skip] Slack domain directory not configured');
      return;
    }
    await backfillHistory(flags, slackBackfillDeps());
  },
});
