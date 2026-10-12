/**
 * @module x/lib/poll-x-items
 *
 * Shared poller for X items via X API v2, called by each `x-poll-*` job
 * with its API poll function and queue prefix: fetches the items for each
 * handle and enqueues them into the jeeves-runner queue that
 * `x-drain-queues` flushes to disk.
 *
 * With no handle argument every handle in `X_ACCOUNTS` is polled (see
 * `poll-handles`); `<handle>` narrows the run to one handle. Options
 * (`--count N`, `--queue NAME`) follow the handle, or stand alone.
 * `--queue` overrides the queue name for every polled handle, so give it
 * together with a handle.
 */

import fs from 'node:fs';

import { argValue, parseRunnableArgs } from '../../lib/args.js';
import {
  handleArg,
  logPollHandles,
  resolvePollHandles,
} from './poll-handles.js';
import type { XClient } from './x-client.js';
import type { XJobDeps } from './x-deps.js';
import { getOAuthPath } from './x-oauth.js';
import type { PollOptions, XTweet } from './x-timelines.js';

/** A poll job's API function and labels. */
export interface PollXOptions {
  /** API poll function to call */
  pollFn: (
    client: XClient,
    handle: string,
    options?: PollOptions,
  ) => Promise<XTweet[]>;
  /** Queue name prefix, e.g. 'x-posts' or 'x-mentions' */
  queuePrefix: string;
  /** Type label for logging and queue payloads */
  typeLabel: string;
  /** Default count of items to fetch */
  defaultCount?: number;
}

/**
 * Poll one handle and enqueue what comes back. An API error is logged and
 * the run carries on.
 */
export async function pollXItems(
  handle: string,
  args: readonly string[],
  options: PollXOptions,
  deps: Pick<XJobDeps, 'withClient' | 'runner'>,
): Promise<void> {
  const parsed = parseRunnableArgs(args, {
    count: argValue('--count', String(options.defaultCount ?? 50)),
    queue: argValue('--queue', `${options.queuePrefix}-${handle}`),
  });
  const count = Number(parsed.count);

  let tweets: XTweet[];
  try {
    tweets = await deps.withClient(handle, (client) =>
      options.pollFn(client, handle, { maxResults: count }),
    );
  } catch (err) {
    console.error(
      `${options.typeLabel}: API error for @${handle}:`,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  if (!tweets.length) {
    console.log(`${options.typeLabel}: no items returned for @${handle}`);
    return;
  }

  const runnerClient = deps.runner();
  try {
    let enqueued = 0,
      dedupSkipped = 0;
    for (const t of tweets) {
      const itemId = runnerClient.enqueue(parsed.queue, {
        id: t.id,
        createdAt: t.createdAt,
        author: t.authorId ?? handle,
        type: options.typeLabel,
        text: t.text,
        raw: t,
      });
      if (itemId === -1) dedupSkipped++;
      else enqueued++;
    }
    console.log(
      `${options.typeLabel}: @${handle} fetched=${String(tweets.length)}, enqueued=${String(enqueued)}, dedupSkipped=${String(dedupSkipped)}`,
    );
  } finally {
    runnerClient.close();
  }
}

/**
 * The handles a poll run covers: the handle argument, else every
 * configured handle; only those with an OAuth file. Logs a `[skip]` line
 * for each handle left out.
 */
export function pollHandles(
  args: readonly string[],
  deps: Pick<XJobDeps, 'accounts' | 'oauthDir'>,
): string[] {
  return logPollHandles(
    resolvePollHandles(handleArg(args), deps.accounts, (h) =>
      fs.existsSync(getOAuthPath(deps.oauthDir, h)),
    ),
  );
}

/**
 * The poll job body: polls each of {@link pollHandles} in turn. An API
 * error for one handle is logged and the next is still polled; any other
 * error fails the run.
 */
export async function runXPoller(
  args: readonly string[],
  options: PollXOptions,
  deps: XJobDeps,
): Promise<void> {
  for (const handle of pollHandles(args, deps))
    await pollXItems(handle, args, options, deps);
}
