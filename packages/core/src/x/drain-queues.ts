/**
 * @module drain-queues
 *
 * Drains all X runner queues to disk as JSON files.
 *
 * Scheduled runner job. Iterates over every handle in `X_ACCOUNTS`,
 * dequeues items from each category queue
 * (posts, mentions, feed, likes, bookmarks), and writes them to the
 * corresponding subdirectory under the account's base path.
 */

import fs from 'node:fs';
import path from 'node:path';

import { defineJob } from '../jobs/define-job.js';
import { argValue, type ParsedArgs } from '../lib/args.js';
import { type XJobDeps, xJobDeps } from './lib/x-deps.js';

/** The queues each account drains, with the subdirectory they flush to. */
export const DRAIN_SUBDIRS = [
  'posts',
  'mentions',
  'feed',
  'likes',
  'bookmarks',
] as const;

/** The flags `x-drain-queues` accepts. */
export const drainXQueuesFlags = {
  maxItems: argValue('--maxItems', '50', {
    description: 'Items to flush per queue',
  }),
};

/**
 * Flush up to `--maxItems` (default 50) items from each of every account's
 * poll queues to `{account}/<subdir>/<id>.json`.
 */
export function drainXQueues(
  flags: ParsedArgs<typeof drainXQueuesFlags>,
  deps: Pick<XJobDeps, 'accounts' | 'runner'>,
): void {
  const maxItems = Number(flags.maxItems);
  const client = deps.runner();
  try {
    let totalProcessed = 0;
    for (const [handle, baseDir] of Object.entries(deps.accounts)) {
      for (const subdir of DRAIN_SUBDIRS) {
        const queue = `x-${subdir}-${handle}`;
        const outDir = path.join(baseDir, subdir);
        fs.mkdirSync(outDir, { recursive: true });
        const items = client.dequeue(queue, maxItems);
        for (const { id: queueItemId, payload } of items) {
          const item = payload as { id?: string; raw?: unknown };
          const id = item.id ?? '';
          if (id) {
            fs.writeFileSync(
              path.join(outDir, `${id}.json`),
              JSON.stringify(item.raw ?? item, null, 2) + '\n',
              'utf8',
            );
            totalProcessed++;
          }
          client.done(queueItemId);
        }
        if (items.length)
          console.log(`${queue}: processed=${String(items.length)}`);
      }
    }
    console.log(`drain: total processed=${String(totalProcessed)}`);
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'x-drain-queues',
  domain: 'x',
  name: 'x/drain-queues',
  flags: drainXQueuesFlags,
  run: ({ flags }) => {
    drainXQueues(flags, xJobDeps());
  },
});
