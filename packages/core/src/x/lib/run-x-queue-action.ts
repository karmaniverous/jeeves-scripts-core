/**
 * @module run-x-queue-action
 *
 * Shared job body for the X queue-action jobs (like, repost).
 *
 * Handles handle parsing, credential check and client creation;
 * drain-x-queue runs the action per item and settles it.
 */

import fs from 'node:fs';

import { getArg } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';
import type { Client } from '@xdevplatform/xdk';

import { drainXQueue } from './drain-x-queue.js';
import { withAutoRefresh } from './x-api.js';
import { getOAuthPath } from './x-oauth.js';

export interface XQueueActionOptions {
  /** Script name shown in the usage line (the job's crash label) */
  scriptName: string;
  /** Queue name prefix, e.g. 'x-like' or 'x-repost' */
  queuePrefix: string;
  /** Label for logging (e.g. 'like', 'repost') */
  actionLabel: string;
  /** Past-tense label for success log (e.g. 'liked', 'reposted') */
  successLabel: string;
  /** The action to perform on each tweet; false fails the queue item. */
  actionFn: (
    client: Client,
    handle: string,
    tweetId: string,
  ) => Promise<boolean>;
}

/**
 * The job body for an X queue-action job (`defineJob`'s `run`).
 */
export function xQueueAction(options: XQueueActionOptions): () => void {
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
      await drainXQueue(
        runnerClient,
        queueName,
        maxItems,
        (tweetId) =>
          withAutoRefresh(handle, (client) =>
            options.actionFn(client, handle, tweetId),
          ),
        options,
        handle,
      );
    } finally {
      runnerClient.close();
    }
  }

  return () => {
    const handle = process.argv[2];
    if (!handle) {
      console.log(
        `[skip] No X account handle provided. Usage: jeeves-scripts run <job-id> <handle> (${options.scriptName})`,
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
  };
}
