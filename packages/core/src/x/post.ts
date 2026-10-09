#!/usr/bin/env tsx
/**
 * @module post
 *
 * Dispatches queued posts, replies, and quotes via X API v2.
 *
 * Entry-point script invoked by the runner scheduler. Reads JSON queue files
 * from the account's queue/ directory, posts each via createPost from x-api,
 * and moves processed files to done/ or failed/ subdirectories.
 *
 * Uses {@link X_ACCOUNTS} from constants to resolve queue and output paths.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import {
  createPost,
  getOAuthPath,
  requireAccountDir,
  requireXHandle,
  withAutoRefresh,
} from './lib/x-api.js';

const handle = requireXHandle('post.ts');
const accountDir = requireAccountDir(handle);
const QUEUE_DIR = path.join(accountDir, 'queue');
const DONE_DIR = path.join(QUEUE_DIR, 'done');
const FAILED_DIR = path.join(QUEUE_DIR, 'failed');
const POSTS_DIR = path.join(accountDir, 'posts');
const MAX_RETRIES = 3;

async function main(): Promise<void> {
  for (const dir of [DONE_DIR, FAILED_DIR, POSTS_DIR])
    fs.mkdirSync(dir, { recursive: true });

  const now = new Date();
  const files = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json'));
  let posted = 0,
    skipped = 0,
    failed = 0;

  for (const file of files) {
    const filePath = path.join(QUEUE_DIR, file);
    let item: {
      text: string;
      type?: string;
      targetTime?: string;
      replyToId?: string;
      quoteId?: string;
      retries?: number;
      lastError?: string;
    };
    try {
      item = JSON.parse(fs.readFileSync(filePath, 'utf8')) as typeof item;
    } catch {
      continue;
    }

    if (new Date(item.targetTime || 0) > now) {
      skipped++;
      continue;
    }

    try {
      const type = item.type || 'tweet';
      const result = await withAutoRefresh(handle, (client) =>
        createPost(client, item.text, {
          inReplyToTweetId: type === 'reply' ? item.replyToId : undefined,
          quoteTweetId: type === 'quote' ? item.quoteId : undefined,
        }),
      );
      const tweetId = result.id || `unknown-${String(Date.now())}`;

      fs.writeFileSync(
        path.join(POSTS_DIR, `${tweetId}.json`),
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

      fs.renameSync(filePath, path.join(DONE_DIR, file));
      posted++;
      console.log(
        `post: posted ${type} (${tweetId}): ${item.text.substring(0, 60)}...`,
      );
    } catch (err) {
      const retries = (item.retries || 0) + 1;
      item.retries = retries;
      item.lastError = err instanceof Error ? err.message : String(err);
      fs.writeFileSync(filePath, JSON.stringify(item, null, 2) + '\n', 'utf8');
      if (retries >= MAX_RETRIES) {
        fs.renameSync(filePath, path.join(FAILED_DIR, file));
        console.log(
          `post: FAILED after ${String(MAX_RETRIES)} retries: ${file}`,
        );
      } else {
        console.log(
          `post: retry ${String(retries)}/${String(MAX_RETRIES)} for ${file}`,
        );
      }
      failed++;
    }
  }

  console.log(
    `post: posted=${String(posted)}, skipped=${String(skipped)}, failed=${String(failed)}`,
  );
}

runScript('x/post', () => {
  if (!fs.existsSync(getOAuthPath(handle))) {
    console.log('[skip] X OAuth2 credentials not configured');
    return;
  }

  main().catch((err: unknown) => {
    console.error(
      'post: FATAL',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
});
