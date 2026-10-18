/**
 * @module poll-feed
 *
 * Polls the home timeline via X API v2 for every handle in constants().X_ACCOUNTS, or
 * only the handle given as the first argument (see lib/poll-handles.ts).
 *
 * Entry-point script invoked by the runner scheduler. Unlike other pollers,
 * writes feed items directly to each account's feed/ directory on disk and
 * prunes entries older than seven days. A failure for one handle is logged,
 * the remaining handles are still polled, and the run then fails.
 *
 * Each account directory comes from `X_ACCOUNTS` (through its silo).
 */

import fs from 'node:fs';
import path from 'node:path';

import { defineJob } from '../jobs/define-job.js';
import { pollHandles } from './lib/poll-x-items.js';
import { type XJobDeps, xJobDeps } from './lib/x-deps.js';
import type { XTweet } from './lib/x-timelines.js';
import { pollHomeTimeline } from './lib/x-timelines.js';

/** Feed items older than this (by mtime) are deleted. */
export const PRUNE_DAYS = 7;

function writeFeedItems(
  feedDir: string,
  tweets: XTweet[],
  source: string,
  now: Date,
): { written: number; skipped: number } {
  let written = 0,
    skipped = 0;
  for (const t of tweets) {
    if (!t.id) continue;
    const filePath = path.join(feedDir, `${t.id}.json`);
    if (fs.existsSync(filePath)) {
      skipped++;
      continue;
    }
    const entry = {
      ...t,
      _feedSource: source,
      _ingestedAt: now.toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    written++;
  }
  return { written, skipped };
}

function pruneOldFiles(feedDir: string, now: Date): number {
  const cutoff = now.getTime() - PRUNE_DAYS * 86400000;
  let pruned = 0;
  for (const file of fs.readdirSync(feedDir)) {
    if (!file.endsWith('.json')) continue;
    const stat = fs.statSync(path.join(feedDir, file));
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(path.join(feedDir, file));
      pruned++;
    }
  }
  return pruned;
}

/** Fetch one handle's home timeline into its feed directory and prune it. */
export async function pollFeed(handle: string, deps: XJobDeps): Promise<void> {
  const baseDir = deps.accounts[handle];
  if (!baseDir) throw new Error(`X account ${handle} is not configured.`);
  const feedDir = path.join(baseDir, 'feed');
  fs.mkdirSync(feedDir, { recursive: true });

  const tweets = await deps.withClient(handle, (client) =>
    pollHomeTimeline(client, handle, { maxResults: 100 }),
  );

  const now = deps.now();
  const result = writeFeedItems(feedDir, tweets, 'timeline', now);
  const pruned = pruneOldFiles(feedDir, now);

  console.log(
    `feed: @${handle} fetched=${String(tweets.length)} (new=${String(result.written)}, dedup=${String(result.skipped)}), pruned=${String(pruned)}`,
  );
}

/**
 * Poll every handle ({@link pollHandles}). One handle failing does not
 * stop the others; the run then fails naming them.
 */
export async function pollFeeds(
  args: readonly string[],
  deps: XJobDeps,
): Promise<void> {
  const failed: string[] = [];
  for (const handle of pollHandles(args, deps)) {
    try {
      await pollFeed(handle, deps);
    } catch (err) {
      console.error(
        `poll-feed: @${handle} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      failed.push(handle);
    }
  }
  if (failed.length > 0)
    throw new Error(`poll-feed failed for @${failed.join(', @')}`);
}

export default defineJob({
  id: 'x-poll-feed',
  domain: 'x',
  name: 'x/poll-feed',
  flags: {},
  positionals: '[handle]',
  run: ({ args }) => pollFeeds(args, xJobDeps()),
});
