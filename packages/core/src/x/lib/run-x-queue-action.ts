/**
 * @module x/lib/run-x-queue-action
 *
 * Shared job declaration for the X queue-action jobs (like, repost): the
 * handle prerequisite (`<handle>` given and an OAuth file) and the body,
 * which drains `x-<action>-<handle>` (`--queue` overrides, `--maxItems`
 * caps; default 50) through `drain-x-queue`.
 */

import type { JobContext, JobPrerequisite } from '../../jobs/define-job.js';
import {
  argOptional,
  argValue,
  type ParsedArgs,
  positionalArgs,
} from '../../lib/args.js';
import { drainXQueue } from './drain-x-queue.js';
import { xHandlePrerequisite } from './x-api.js';
import type { XClient } from './x-client.js';
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
    client: XClient,
    handle: string,
    tweetId: string,
  ) => Promise<boolean>;
}

/** The flags a queue-action job accepts. */
export const xQueueActionFlags = {
  maxItems: argValue('--maxItems', '50', { description: 'Items to process' }),
  queue: argOptional('--queue', {
    description: 'Runner queue to drain (default <prefix>-<handle>)',
  }),
};

/** Parsed {@link xQueueActionFlags}. */
export type XQueueActionFlags = ParsedArgs<typeof xQueueActionFlags>;

/** Drain the handle's action queue. */
export async function runXQueueAction(
  args: readonly string[],
  flags: XQueueActionFlags,
  options: XQueueActionOptions,
  deps: Pick<XJobDeps, 'runner' | 'withClient'>,
): Promise<void> {
  const handle = positionalArgs(args, xQueueActionFlags)[0] ?? '';
  const queue = flags.queue ?? `${options.queuePrefix}-${handle}`;
  const runnerClient = deps.runner();
  try {
    await drainXQueue(
      runnerClient,
      queue,
      Number(flags.maxItems),
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
  flags: typeof xQueueActionFlags;
  positionals: string;
  prerequisite: JobPrerequisite<typeof xQueueActionFlags>;
  run: (ctx: JobContext<typeof xQueueActionFlags>) => Promise<void>;
} {
  return {
    flags: xQueueActionFlags,
    positionals: '<handle>',
    prerequisite: xHandlePrerequisite({
      scriptName: options.scriptName,
      ...xConfig,
    }),
    run: ({ args, flags }) => runXQueueAction(args, flags, options, xJobDeps()),
  };
}
