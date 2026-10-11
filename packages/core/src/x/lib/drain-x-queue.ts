/**
 * @module drain-x-queue
 *
 * Drains one X action queue (like, repost): runs the action for each
 * dequeued tweet id and settles the item. An item succeeds only when the
 * action returns true; a false result (e.g. the handle no longer
 * resolves) or a thrown error fails it through `RunnerClient.fail`.
 * Items without a tweet id are settled as done (nothing to do).
 *
 * Called by run-x-queue-action.
 */

import type { RunnerClient } from '@karmaniverous/jeeves-runner';

/** Labels used in the per-item warning and the run summary. */
export interface DrainLabels {
  /** Action name, e.g. 'like'. */
  actionLabel: string;
  /** Past tense for the summary, e.g. 'liked'. */
  successLabel: string;
}

/** Counts for one drain. */
export interface DrainResult {
  succeeded: number;
  failed: number;
}

/**
 * Dequeue up to `maxItems` from `queueName` and run `act` on each tweet id.
 *
 * @param client - Runner client (dequeue, done, fail).
 * @param queueName - Queue to drain.
 * @param maxItems - Most items to take this run.
 * @param act - Performs the action; resolves true on success.
 * @param labels - Log labels.
 * @param handle - Handle, for the summary line.
 * @returns Success and failure counts.
 */
export async function drainXQueue(
  client: Pick<RunnerClient, 'dequeue' | 'done' | 'fail'>,
  queueName: string,
  maxItems: number,
  act: (tweetId: string) => Promise<boolean>,
  labels: DrainLabels,
  handle: string,
): Promise<DrainResult> {
  const result: DrainResult = { succeeded: 0, failed: 0 };

  for (const { id, payload } of client.dequeue(queueName, maxItems)) {
    const tweetId = (payload as { tweetId?: string } | null)?.tweetId;
    if (!tweetId) {
      client.done(id);
      continue;
    }

    let error: string;
    try {
      if (await act(tweetId)) {
        client.done(id);
        result.succeeded++;
        continue;
      }
      error = `@${handle} did not resolve to an X user`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    console.log(
      `${labels.actionLabel}: WARN failed to ${labels.actionLabel} ${tweetId}: ${error}`,
    );
    client.fail(id, error);
    result.failed++;
  }

  console.log(
    `${labels.actionLabel}: @${handle} ${labels.successLabel}=${String(result.succeeded)}, failed=${String(result.failed)}`,
  );
  return result;
}
