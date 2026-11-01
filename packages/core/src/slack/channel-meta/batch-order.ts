/**
 * @module slack/channel-meta/batch-order
 *
 * Which channels the worker gets when more need text than `maxChannels`:
 * the least recently processed first, so busy channels can't starve the
 * rest. A channel's turn is the oldest `checkedAt` (when the job last
 * generated the field, `channel-meta/state`) among the fields it needs; a field
 * never generated comes first; ties go by channel name. The worker takes
 * the first `maxChannels`; the rest wait for a later run, in the same
 * order. A channel that is processed moves to the back, because its
 * fields get this run's `checkedAt`. Pure.
 */

import type { Wanted } from './apply-result.js';
import type { JobState } from './state.js';

/** The batch and the channels left for a later run. */
export interface BatchSplit {
  /** Channels sent to the worker this run. */
  batch: Wanted[];
  /** Channels that wait (over the cap). */
  deferred: Wanted[];
}

/** A channel's turn: its oldest `checkedAt` among the wanted fields
 * (`''`, first, when one was never generated). */
const turnOf = (w: Wanted, state: JobState): string => {
  const saved = state.channels[w.id];
  return w.fields
    .map((field) => saved?.[field]?.checkedAt ?? '')
    .reduce((a, b) => (b < a ? b : a));
};

/**
 * Order the channels that need text least recently processed first, and
 * split them at the cap.
 *
 * @param wanted - Channels that need text (non-empty `fields` each).
 * @param state - The state the run started from.
 * @param maxChannels - Channels per run.
 * @returns The batch and the deferred channels.
 */
export function splitBatch(
  wanted: readonly Wanted[],
  state: JobState,
  maxChannels: number,
): BatchSplit {
  const ordered = wanted
    .map((w) => ({ w, turn: turnOf(w, state) }))
    .sort(
      (a, b) =>
        (a.turn < b.turn ? -1 : a.turn > b.turn ? 1 : 0) ||
        a.w.facts.channel.name.localeCompare(b.w.facts.channel.name),
    )
    .map(({ w }) => w);
  return {
    batch: ordered.slice(0, maxChannels),
    deferred: ordered.slice(maxChannels),
  };
}
