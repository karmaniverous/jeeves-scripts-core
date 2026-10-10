/**
 * @module slack/lib/cursors
 *
 * Slack poller read positions (the newest seen `ts` per channel).
 *
 * Read positions are instance STATE, not config
 * (karmaniverous/jeeves-tools#184). Like the other pollers (calendar
 * `lastSync-<email>`, github `watch-<user>`), they live in the
 * jeeves-runner state store: namespace `slack`, one scalar key per
 * channel, `lastTs-<channelId>`.
 *
 * Absent state means "read the channel from the beginning". An
 * unreachable store is an error: the poll run fails rather than
 * silently re-reading every channel. A stored position that is not a
 * Slack timestamp is also an error.
 *
 * The one-time migration of legacy `lastTs` values out of `channels.json`
 * is gone: the live instance's channels.json had none left when that
 * file was retired (2026-10-10).
 */

import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { z } from 'zod';

/** Runner state namespace for Slack poller state. */
export const SLACK_STATE_NAMESPACE = 'slack';

/** Runner state key holding a channel's read position. */
export function cursorKey(channelId: string): string {
  return `lastTs-${channelId}`;
}

/** A Slack message timestamp (`<seconds>.<micros>`), e.g. `1700000000.000100`. */
export const slackTsSchema = z
  .string()
  .regex(/^\d+\.\d+$/, 'expected a Slack ts like 1700000000.000100');

/** A validated Slack message timestamp. */
export type SlackTs = z.infer<typeof slackTsSchema>;

/** Read position per channel ID. */
export type Cursors = Record<string, SlackTs>;

/**
 * Run a store operation, rethrowing any failure as a clear poll-fatal
 * error.
 */
function withStore<T>(op: () => T): T {
  try {
    return op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Slack read positions unavailable: runner state store error (${msg}). Aborting poll.`,
      { cause: err },
    );
  }
}

/**
 * Persist one channel's read position to the runner state store.
 *
 * @throws If the store cannot be written.
 */
export function saveCursor(
  client: RunnerClient,
  channelId: string,
  ts: string,
): void {
  withStore(() => {
    client.setState(SLACK_STATE_NAMESPACE, cursorKey(channelId), ts);
  });
}

/**
 * Load the read positions of `channelIds` from the runner state store.
 * The store is probed first, so an unavailable store fails even with no
 * channels. A channel without a stored position is absent from the
 * result (read from the beginning).
 *
 * @throws If the store cannot be read, or a stored position is not a
 * Slack ts.
 */
export function loadPollCursors(
  client: RunnerClient,
  channelIds: readonly string[],
): Cursors {
  const read = (id: string): string | null =>
    withStore(() => client.getState(SLACK_STATE_NAMESPACE, cursorKey(id)));

  // Probe (key `lastTs-`, never a channel).
  read('');

  const cursors: Cursors = {};
  for (const id of channelIds) {
    const stored = read(id);
    if (stored === null) continue;
    const parsed = slackTsSchema.safeParse(stored);
    if (!parsed.success)
      throw new Error(
        `Invalid Slack read position ${JSON.stringify(stored)} in runner state ${cursorKey(id)}: ${parsed.error.issues.map((i) => i.message).join('; ')}. Aborting poll.`,
      );
    cursors[id] = parsed.data;
  }
  return cursors;
}
