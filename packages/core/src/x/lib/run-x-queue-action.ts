/**
 * @module x/lib/run-x-queue-action
 *
 * Shared job declaration for the X queue-action jobs (like, repost): the
 * handle prerequisite (`<handle>` given and an OAuth file) and the body,
 * which drains `x-<action>-<handle>` (`--queue` overrides, `--maxItems`
 * caps; default 50) through `drain-x-queue`.
 */

import type { Client } from '@xdevplatform/xdk';

import type { JobContext, JobPrerequisite } from '../../jobs/define-job.js';
import { argValue, parseRunnableArgs } from '../../lib/args.js';
import { drainXQueue } from './drain-x-queue.js';
import { xHandlePrerequisite } from './x-api.js';
import { xConfig, type XJobDeps, xJobDeps } from './x-deps.js';

/** A queue action's labels and API call. */
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

/** Drain the handle's action queue. */
export async function runXQueueAction(
  args: readonly string[],
  options: XQueueActionOptions,
  deps: Pick<XJobDeps, 'runner' | 'withClient'>,
): Promise<void> {
  const handle = args[0] ?? '';
  const parsed = parseRunnableArgs(args, {
    maxItems: argValue('--maxItems', '50'),
    queue: argValue('--queue', `${options.queuePrefix}-${handle}`),
  });
  const runnerClient = deps.runner();
  try {
    await drainXQueue(
      runnerClient,
      parsed.queue,
      Number(parsed.maxItems),
      (tweetId) =>
        deps.withClient(handle, (client) =>
          options.actionFn(client, handle, tweetId),
        ),
      options,
      handle,
    );
  } finally {
    runnerClient.close();
  }
}

/** The `prerequisite` and `run` of a queue-action job. */
export function xQueueAction(options: XQueueActionOptions): {
  prerequisite: JobPrerequisite;
  run: (ctx: JobContext) => Promise<void>;
} {
  return {
    prerequisite: xHandlePrerequisite({
      scriptName: options.scriptName,
      ...xConfig,
    }),
    run: ({ args }) => runXQueueAction(args, options, xJobDeps()),
  };
}
