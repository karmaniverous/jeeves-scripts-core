/**
 * @module slack/lib/read-channel
 *
 * Read one Slack channel oldest-first, a history page at a time, writing
 * each message (and its replies) to the archive and recording the read
 * position after each top-level message. Shared by `slack-poll` and
 * `slack-backfill-history` (#50).
 */

import { resolveChannelDir } from './channel-dir.js';
import type { ChannelInfo } from './channel-info.js';
import { enrichFileContent } from './file-content.js';
import { writeMessage } from './message-writer.js';
import {
  fetchHistoryPage,
  fetchReplies,
  RATE_LIMIT_MS,
  type SlackMessage,
  sleep,
} from './slack-api.js';
import { refreshParticipants } from './slack-sync.js';

/** How one run reads one channel. */
export interface ChannelRun {
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
  /** Stop before the first top-level message at or after this ts (unset: read to the end). */
  before?: string;
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
 * progresses); `more` says the channel has unread history left. With
 * `before`, reading ends at the first top-level message at or after it.
 */
export async function pollChannel(
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
      if (run.before !== undefined && msg.ts >= run.before)
        return { written, more: false };
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
