/**
 * @module x/post
 *
 * Publishes the queued posts, replies and quotes of one X account: reads
 * the JSON files in `{account}/queue/`, posts each one that is due through
 * X API v2, writes the posted tweet to `{account}/posts/<id>.json` and
 * moves the queue file to `done/`. A failed post is retried on later runs
 * and moved to `failed/` after three tries.
 *
 * Usage: `jeeves-scripts run x-post <handle>`. The prerequisite skips
 * (exit 0) without a handle, an unconfigured account or an OAuth file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { defineJob } from '../jobs/define-job.js';
import { createPost } from './lib/x-actions.js';
import { xHandlePrerequisite } from './lib/x-api.js';
import { xConfig, type XJobDeps, xJobDeps } from './lib/x-deps.js';

/** Tries before a queue file is moved to `failed/`. */
export const MAX_RETRIES = 3;

/** A queue file. */
interface QueuedPost {
  text: string;
  type?: string;
  targetTime?: string;
  replyToId?: string;
  quoteId?: string;
  retries?: number;
  lastError?: string;
}

/** The account's queue, done, failed and posts directories. */
function postDirs(accountDir: string) {
  const queue = path.join(accountDir, 'queue');
  return {
    queue,
    done: path.join(queue, 'done'),
    failed: path.join(queue, 'failed'),
    posts: path.join(accountDir, 'posts'),
  };
}

type Outcome = 'posted' | 'skipped' | 'failed' | 'unreadable';

/** Post one queue file if it is due. */
async function postOne(
  handle: string,
  file: string,
  dirs: ReturnType<typeof postDirs>,
  now: Date,
  deps: Pick<XJobDeps, 'withClient'>,
): Promise<Outcome> {
  const filePath = path.join(dirs.queue, file);
  let item: QueuedPost;
  try {
    item = JSON.parse(fs.readFileSync(filePath, 'utf8')) as QueuedPost;
  } catch {
    return 'unreadable';
  }
  if (new Date(item.targetTime ?? 0) > now) return 'skipped';

  try {
    const type = item.type ?? 'tweet';
    const result = await deps.withClient(handle, (client) =>
      createPost(client, item.text, {
        inReplyToTweetId: type === 'reply' ? item.replyToId : undefined,
        quoteTweetId: type === 'quote' ? item.quoteId : undefined,
      }),
    );
    const tweetId = result.id ?? `unknown-${String(now.getTime())}`;
    fs.writeFileSync(
      path.join(dirs.posts, `${tweetId}.json`),
      JSON.stringify(
        {
          id: tweetId,
          text: item.text,
          type,
          postedAt: now.toISOString(),
          targetTime: item.targetTime,
          via: 'x-api-v2',
          apiResult: result,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    fs.renameSync(filePath, path.join(dirs.done, file));
    console.log(
      `post: posted ${type} (${tweetId}): ${item.text.substring(0, 60)}...`,
    );
    return 'posted';
  } catch (err) {
    const retries = (item.retries ?? 0) + 1;
    item.retries = retries;
    item.lastError = err instanceof Error ? err.message : String(err);
    fs.writeFileSync(filePath, JSON.stringify(item, null, 2) + '\n', 'utf8');
    if (retries >= MAX_RETRIES) {
      fs.renameSync(filePath, path.join(dirs.failed, file));
      console.log(`post: FAILED after ${String(MAX_RETRIES)} retries: ${file}`);
    } else {
      console.log(
        `post: retry ${String(retries)}/${String(MAX_RETRIES)} for ${file}`,
      );
    }
    return 'failed';
  }
}

/** Publish the handle's due queue files. */
export async function postQueue(
  handle: string,
  deps: Pick<XJobDeps, 'accounts' | 'withClient' | 'now'>,
): Promise<void> {
  const accountDir = deps.accounts[handle];
  if (!accountDir) throw new Error(`X account ${handle} is not configured.`);
  const dirs = postDirs(accountDir);
  for (const dir of [dirs.done, dirs.failed, dirs.posts])
    fs.mkdirSync(dir, { recursive: true });

  const now = deps.now();
  const counts = { posted: 0, skipped: 0, failed: 0, unreadable: 0 };
  const files = fs.readdirSync(dirs.queue).filter((f) => f.endsWith('.json'));
  for (const file of files)
    counts[await postOne(handle, file, dirs, now, deps)]++;

  console.log(
    `post: posted=${String(counts.posted)}, skipped=${String(counts.skipped)}, failed=${String(counts.failed)}`,
  );
}

export default defineJob({
  id: 'x-post',
  domain: 'x',
  description:
    "Publish the queued posts, replies and quotes in an X account's queue folder.",
  name: 'x/post',
  // Checked in order: handle argument, configured account, OAuth file.
  prerequisite: xHandlePrerequisite({
    scriptName: 'post.ts',
    requireAccount: true,
    ...xConfig,
  }),
  run: ({ args }) => postQueue(args[0] ?? '', xJobDeps()),
});
