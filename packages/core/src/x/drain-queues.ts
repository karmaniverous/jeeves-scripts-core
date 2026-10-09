#!/usr/bin/env tsx
/**
 * @module drain-queues
 *
 * Drains all X runner queues to disk as JSON files.
 *
 * Entry-point script invoked by the runner scheduler. Iterates over every
 * handle in {@link constants().X_ACCOUNTS}, dequeues items from each category queue
 * (posts, mentions, feed, likes, bookmarks), and writes them to the
 * corresponding subdirectory under the account's base path.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getArg, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { constants } from '../lib/constants.js';

function main(): void {
  const argv = process.argv.slice(2);
  const maxItems = Number(getArg(argv, '--maxItems', '50'));
  const client = getRunnerClient();

  const queues: Array<{ queue: string; subdir: string; handle: string }> = [];
  for (const handle of Object.keys(constants().X_ACCOUNTS)) {
    queues.push({ queue: `x-posts-${handle}`, subdir: 'posts', handle });
    queues.push({
      queue: `x-mentions-${handle}`,
      subdir: 'mentions',
      handle,
    });
    queues.push({ queue: `x-feed-${handle}`, subdir: 'feed', handle });
    queues.push({ queue: `x-likes-${handle}`, subdir: 'likes', handle });
    queues.push({
      queue: `x-bookmarks-${handle}`,
      subdir: 'bookmarks',
      handle,
    });
  }

  try {
    let totalProcessed = 0;
    for (const { queue, subdir, handle } of queues) {
      const baseDir = constants().X_ACCOUNTS[handle];
      const outDir = path.join(baseDir, subdir);
      fs.mkdirSync(outDir, { recursive: true });
      const items = client.dequeue(queue, maxItems);

      for (const { id: queueItemId, payload } of items) {
        const item = payload as { id?: string; raw?: unknown };
        const id = item.id || '';
        if (!id) {
          client.done(queueItemId);
          continue;
        }
        const filePath = path.join(outDir, `${id}.json`);
        fs.writeFileSync(
          filePath,
          JSON.stringify(item.raw ?? item, null, 2) + '\n',
          'utf8',
        );
        client.done(queueItemId);
        totalProcessed++;
      }

      if (items.length)
        console.log(`${queue}: processed=${String(items.length)}`);
    }
    console.log(`drain: total processed=${String(totalProcessed)}`);
  } finally {
    client.close();
  }
}

runScript('x/drain-queues', main);
