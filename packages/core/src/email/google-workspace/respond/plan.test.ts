import { describe, expect, it, vi } from 'vitest';

import { candidate, CONFIG, SENDER } from './orchestrate.fixtures.js';
import { planCandidates, selectForRun } from './plan.js';
import { type MessageState } from './state.js';

describe('planCandidates', () => {
  it('marks a permanently-handled message as already-handled, skipping qualification', () => {
    const c = candidate();
    const getState = vi.fn((): MessageState => ({
      status: 'replied',
      attempts: 1,
      at: 'x',
      threadId: 't1',
    }));
    const planned = planCandidates([c], CONFIG, getState);
    expect(planned).toEqual([{ kind: 'already-handled', candidate: c }]);
  });

  it('records a qualification failure as a skip with reason', () => {
    const c = candidate({
      headers: { ...candidate().headers, from: 'stranger@example.com' },
    });
    const planned = planCandidates([c], CONFIG, () => null);
    expect(planned).toEqual([
      {
        kind: 'skip',
        candidate: c,
        reason: 'sender stranger@example.com is not in allowedSenders',
      },
    ]);
  });

  it('plans a qualifying candidate for processing', () => {
    const c = candidate();
    const planned = planCandidates([c], CONFIG, () => null);
    expect(planned).toEqual([
      {
        kind: 'candidate',
        candidate: c,
        sender: { name: 'Jane', email: SENDER },
      },
    ]);
  });
});

describe('selectForRun', () => {
  function planned(id: string, threadId: string, ms: number) {
    return {
      kind: 'candidate' as const,
      candidate: candidate({ messageId: id, threadId, internalDateMs: ms }),
      sender: { name: 'Jane', email: SENDER },
    };
  }

  it('orders selected candidates oldest first', () => {
    const items = [planned('m2', 't2', 2000), planned('m1', 't1', 1000)];
    const result = selectForRun(items, CONFIG, () => 0, 10_000);
    expect(result.selected.map((i) => i.candidate.messageId)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('selects at most one message per thread per run (oldest first)', () => {
    const items = [
      planned('m2', 't1', 2000),
      planned('m1', 't1', 1000),
      planned('m3', 't2', 3000),
    ];
    const result = selectForRun(items, CONFIG, () => 0, 10_000);
    expect(result.selected.map((i) => i.candidate.messageId)).toEqual([
      'm1',
      'm3',
    ]);
    expect(result.capped).toEqual([]);
  });

  it('caps selection at maxPerRun', () => {
    const items = [
      planned('m1', 't1', 1000),
      planned('m2', 't2', 2000),
      planned('m3', 't3', 3000),
      planned('m4', 't4', 4000),
    ];
    const result = selectForRun(
      items,
      { ...CONFIG, maxPerRun: 2 },
      () => 0,
      10_000,
    );
    expect(result.selected).toHaveLength(2);
    expect(result.selected.map((i) => i.candidate.messageId)).toEqual([
      'm1',
      'm2',
    ]);
  });

  it('holds candidates once a thread is at its hourly cap', () => {
    const items = [planned('m1', 't1', 1000), planned('m2', 't2', 2000)];
    // t1 already has 3 replies in the last hour (cap 3); t2 has 2.
    const result = selectForRun(
      items,
      { ...CONFIG, maxRepliesPerThreadPerHour: 3 },
      (threadId) => (threadId === 't1' ? 3 : 2),
      10_000,
    );
    expect(result.selected.map((i) => i.candidate.messageId)).toEqual(['m2']);
    expect(result.capped.map((i) => i.candidate.messageId)).toEqual(['m1']);
  });

  it('counts replies already recorded, using the 1-hour window passed to threadReplyCountSince', () => {
    const items = [planned('m1', 't1', 1000)];
    const countSince = vi.fn(() => 0);
    const nowMs = 10 * 60 * 60 * 1000;
    selectForRun(items, CONFIG, countSince, nowMs);
    expect(countSince).toHaveBeenCalledWith('t1', nowMs - 60 * 60 * 1000);
  });
});
