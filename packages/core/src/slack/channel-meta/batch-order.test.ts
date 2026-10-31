/**
 * Tests for the batch order: fields never generated first, then the
 * oldest `checkedAt` among a channel's wanted fields, ties by name; the
 * cap splits the batch from the channels that wait.
 */

import { describe, expect, it } from 'vitest';

import type { Wanted } from './apply-result.js';
import { splitBatch } from './batch-order.js';
import { channel, workspace } from './fakes.test-helper.js';
import type { ChannelFacts } from './gather.js';
import type { MetaField } from './plan.js';
import { emptyState, type JobState } from './state.js';

const wanted = (name: string, fields: MetaField[]): Wanted => {
  const id = `C${name.toUpperCase()}`;
  return {
    id,
    fields,
    facts: { channel: channel(id, { name }) } as ChannelFacts,
    ws: workspace('default', []),
    reasons: {},
  };
};

const checked = (checkedAt: string) => ({ checkedAt });

const STATE: JobState = {
  ...emptyState(),
  channels: {
    CA: { description: checked('2026-10-03'), topic: checked('2026-10-01') },
    CB: { description: checked('2026-10-02') },
    CC: { description: checked('2026-10-02'), topic: checked('2026-10-05') },
    CD: { topic: checked('2026-10-01') },
  },
};

const ids = (ws: readonly Wanted[]) => ws.map((w) => w.id);

describe('splitBatch', () => {
  it('puts never-generated fields first, then the oldest turn, ties by name', () => {
    const { batch, deferred } = splitBatch(
      [
        wanted('c', ['description', 'topic']),
        wanted('a', ['description']),
        wanted('b', ['description']),
        wanted('d', ['description', 'topic']),
        wanted('e', ['topic']),
      ],
      STATE,
      3,
    );
    // d: description never generated; e: never seen; then b and c tie on
    // 2026-10-02 (c's oldest wanted field), a's description is 2026-10-03.
    expect(ids(batch)).toEqual(['CD', 'CE', 'CB']);
    expect(ids(deferred)).toEqual(['CC', 'CA']);
  });

  it("takes a channel's oldest wanted field wherever it is in the list", () => {
    // CA: its topic (2026-10-01) is older than its description
    // (2026-10-03), so it goes before CB (2026-10-02).
    const { batch } = splitBatch(
      [wanted('b', ['description']), wanted('a', ['description', 'topic'])],
      STATE,
      2,
    );
    expect(ids(batch)).toEqual(['CA', 'CB']);
  });

  it('judges a channel only by the fields it needs', () => {
    const { batch } = splitBatch(
      [wanted('a', ['description']), wanted('c', ['description'])],
      STATE,
      1,
    );
    // a's older topic (2026-10-01) is not wanted: its description
    // (2026-10-03) is newer than c's (2026-10-02).
    expect(ids(batch)).toEqual(['CC']);
  });

  it('sends everything when under the cap', () => {
    const all = [wanted('a', ['topic']), wanted('b', ['description'])];
    expect(splitBatch(all, emptyState(), 5)).toEqual({
      batch: all,
      deferred: [],
    });
  });
});
