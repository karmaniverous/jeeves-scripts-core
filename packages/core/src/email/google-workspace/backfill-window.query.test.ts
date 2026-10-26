/**
 * Tests for the backfill window arithmetic and query (`nextBackfillWindow`,
 * `backfillQuery`): pure functions, no runner store or gog.
 */

import { describe, expect, it } from 'vitest';

import { backfillQuery, nextBackfillWindow } from './backfill-window.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-04T00:00:00.000Z');
const SETTINGS = { lookbackDays: 10, windowDays: 4 };

describe('nextBackfillWindow', () => {
  it('starts at now when there is no cursor', () => {
    expect(nextBackfillWindow(null, NOW, SETTINGS)).toEqual({
      after: new Date(NOW.getTime() - 4 * DAY),
      before: NOW,
    });
  });

  it('clamps the last window to the lookback limit', () => {
    const cursor = new Date(NOW.getTime() - 8 * DAY).toISOString();
    expect(nextBackfillWindow(cursor, NOW, SETTINGS)).toEqual({
      after: new Date(NOW.getTime() - 10 * DAY),
      before: new Date(cursor),
    });
  });

  it('returns null at or past the lookback limit', () => {
    const at = new Date(NOW.getTime() - 10 * DAY).toISOString();
    const past = new Date(NOW.getTime() - 11 * DAY).toISOString();
    expect(nextBackfillWindow(at, NOW, SETTINGS)).toBeNull();
    expect(nextBackfillWindow(past, NOW, SETTINGS)).toBeNull();
  });

  it('rejects a corrupt cursor', () => {
    expect(() => nextBackfillWindow('garbage', NOW, SETTINGS)).toThrow(
      /Invalid backfill cursor "garbage"/,
    );
  });
});

describe('backfillQuery', () => {
  it('uses epoch seconds, flooring sub-second instants', () => {
    expect(
      backfillQuery({
        after: new Date('2026-01-01T00:00:00Z'),
        before: new Date('2026-01-02T00:00:00.999Z'),
      }),
    ).toBe('after:1767225600 before:1767312000');
  });
});
