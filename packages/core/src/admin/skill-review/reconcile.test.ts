/**
 * Tests for reconciling the reviewed proposals with the Workshop at
 * posting time: unchanged, revised (draft hash or update time), decided,
 * newly created, and the snapshot fallbacks (refresh failed, list capped).
 */

import { describe, expect, it } from 'vitest';

import { type ProposalState, reconcile } from './reconcile.js';

const p = (id: string, over: Partial<ProposalState> = {}): ProposalState => ({
  id,
  skillName: `${id}-skill`,
  kind: 'update',
  draftHash: `hash-${id}`,
  updatedAt: '2026-10-21T00:00:00Z',
  ...over,
});

const REVIEWED = [p('a'), p('b'), p('c')];

describe('reconcile', () => {
  it('keeps unchanged proposals and adds newly created ones', () => {
    expect(reconcile(REVIEWED, [...REVIEWED, p('d')], 50)).toEqual({
      current: REVIEWED,
      revised: [],
      added: [p('d')],
      decided: 0,
      snapshot: false,
    });
  });

  it.each([
    ['its draft hash', { draftHash: 'hash-new' }],
    ['its update time', { updatedAt: '2026-10-22T00:00:00Z' }],
  ])('moves a proposal to revised when %s changed', (_case, change) => {
    const latest = p('b', change);
    const result = reconcile(REVIEWED, [p('a'), latest, p('c')], 50);
    expect(result.current).toEqual([p('a'), p('c')]);
    expect(result.revised).toEqual([latest]);
  });

  it('counts reviewed proposals no longer pending as decided', () => {
    const result = reconcile(REVIEWED, [p('a')], 50);
    expect(result.current).toEqual([p('a')]);
    expect(result.decided).toBe(2);
    expect(result.snapshot).toBe(false);
  });

  it('keeps missing proposals when the refreshed list hit the limit', () => {
    const result = reconcile(REVIEWED, [p('a'), p('x')], 2);
    expect(result.current).toEqual(REVIEWED);
    expect(result.decided).toBe(0);
    expect(result.added).toEqual([p('x')]);
    expect(result.snapshot).toBe(true);
  });

  it('falls back to the review snapshot when the refresh failed', () => {
    expect(reconcile(REVIEWED, undefined, 50)).toEqual({
      current: REVIEWED,
      revised: [],
      added: [],
      decided: 0,
      snapshot: true,
    });
  });
});
