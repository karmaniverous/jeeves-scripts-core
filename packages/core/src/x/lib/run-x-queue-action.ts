/**
 * @module run-x-queue-action
 *
 * Shared entry-point wrapper for X queue-action scripts (like, repost).
 *
 * Handles handle parsing, credential check, client creation, queue draining,
 * action execution with per-item error handling, and runScript boilerplate.
 */

import fs from 'node:fs';

import { getArg, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';
import type { Client } from '@xdevplatform/xdk';

import { getOAuthPath, withAutoRefresh } from './x-api.js';

export interface XQueueActionOptions {
  /** Script name for runScript wrapper */
  scriptName: string;
  /** Queue name prefix, e.g. 'x-like' or 'x-repost' */
  queuePrefix: string;
  /** Label for logging (e.g. 'like', 'repost') */
  actionLabel: string;
  /** Past-tense label for success log (e.g. 'liked', 'reposted') */
  successLabel: string;
  /** The action to perform on each tweet */
  actionFn: (
    client: Client,
    handle: string,
    tweetId: string,
  ) => Promise<boolean>;
}

/**
 * Entry-point wrapper for X queue-action scripts.
 */
export function runXQueueAction(options: XQueueActionOptions): void {
  async function main(handle: string): Promise<void> {
    const argv = process.argv.slice(2);
    const maxItems = Number(getArg(argv, '--maxItems', '50'));
    const queueName = getArg(
      argv,
      '--queue',
      `${options.queuePrefix}-${handle}`,
    );

    const runnerClient = getRunnerClient();
    try {
      const items = runnerClient.dequeue(queueName, maxItems);
      let succeeded = 0,
        failed = 0;

      for (const { id: queueItemId, payload } of items) {
        const tweetId = (payload as { tweetId?: string }).tweetId;
        if (!tweetId) {
          runnerClient.done(queueItemId);
          continue;
        }

        try {
          await withAutoRefresh(handle, (client) =>
            options.actionFn(client, handle, tweetId),
          );
          runnerClient.done(queueItemId);
          succeeded++;
        } catch (err) {
          console.log(
            `${options.actionLabel}: WARN failed to ${options.actionLabel} ${tweetId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          failed++;
        }
      }

      console.log(
        `${options.actionLabel}: @${handle} ${options.successLabel}=${String(succeeded)}, failed=${String(failed)}`,
      );
    } finally {
      runnerClient.close();
    }
  }

  runScript(options.scriptName, () => {
    const handle = process.argv[2];
    if (!handle) {
      console.log(
        `[skip] No X account handle provided. Usage: tsx ${options.scriptName} <handle>`,
      );
      return;
    }

    if (!fs.existsSync(getOAuthPath(handle))) {
      console.log('[skip] X OAuth2 credentials not configured');
      return;
    }

    main(handle).catch((err: unknown) => {
      console.error(
        `${options.actionLabel}: FATAL`,
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    });
  });
}
