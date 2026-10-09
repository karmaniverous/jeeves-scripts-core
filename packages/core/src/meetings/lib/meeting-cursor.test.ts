import { describe, expect, it } from 'vitest';

import {
  advanceCursor,
  compareMeetings,
  emptyCursor,
  isAfterCursor,
  selectBatch,
  sortMeetings,
} from './meeting-cursor.js';

describe('compareMeetings', () => {
  it('sorts by sortTimestampMs first', () => {
    const a = { meetingId: 'b', sortTimestampMs: 1000, date: '2026-04-09' };
    const b = { meetingId: 'a', sortTimestampMs: 2000, date: '2026-04-08' };
    expect(compareMeetings(a, b)).toBeLessThan(0);
  });

  it('meetings with timestamps sort before those without', () => {
    const a = { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' };
    const b = { meetingId: 'b', sortTimestampMs: null, date: '2026-04-08' };
    expect(compareMeetings(a, b)).toBeLessThan(0);
  });

  it('falls back to date when timestamps are null', () => {
    const a = { meetingId: 'a', sortTimestampMs: null, date: '2026-04-08' };
    const b = { meetingId: 'b', sortTimestampMs: null, date: '2026-04-09' };
    expect(compareMeetings(a, b)).toBeLessThan(0);
  });

  it('falls back to meetingId as tie-breaker', () => {
    const a = { meetingId: 'aaa', sortTimestampMs: 1000, date: '2026-04-09' };
    const b = { meetingId: 'bbb', sortTimestampMs: 1000, date: '2026-04-09' };
    expect(compareMeetings(a, b)).toBeLessThan(0);
  });

  it('returns 0 for identical meetings', () => {
    const a = { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' };
    expect(compareMeetings(a, { ...a })).toBe(0);
  });
});

describe('sortMeetings', () => {
  it('sorts meetings chronologically', () => {
    const meetings = [
      { meetingId: 'c', sortTimestampMs: 3000, date: '2026-04-11' },
      { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' },
      { meetingId: 'b', sortTimestampMs: 2000, date: '2026-04-10' },
    ];
    const sorted = sortMeetings(meetings);
    expect(sorted.map((m) => m.meetingId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate input', () => {
    const meetings = [
      { meetingId: 'b', sortTimestampMs: 2000, date: '2026-04-10' },
      { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' },
    ];
    sortMeetings(meetings);
    expect(meetings[0].meetingId).toBe('b');
  });

  it('handles mixed null and non-null timestamps', () => {
    const meetings = [
      { meetingId: 'c', sortTimestampMs: null, date: '2026-04-11' },
      { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' },
      { meetingId: 'b', sortTimestampMs: null, date: '2026-04-10' },
    ];
    const sorted = sortMeetings(meetings);
    // Timestamped ones first, then by date
    expect(sorted[0].meetingId).toBe('a');
    expect(sorted[1].meetingId).toBe('b');
    expect(sorted[2].meetingId).toBe('c');
  });
});

describe('isAfterCursor', () => {
  it('returns true for empty cursor', () => {
    const meeting = {
      meetingId: 'a',
      sortTimestampMs: 1000,
      date: '2026-04-09',
    };
    expect(isAfterCursor(meeting, emptyCursor())).toBe(true);
  });

  it('returns true when meeting timestamp is after cursor', () => {
    const meeting = {
      meetingId: 'a',
      sortTimestampMs: 2000,
      date: '2026-04-09',
    };
    const cursor = {
      lastTimestampMs: 1000,
      lastDate: '2026-04-09',
      lastMeetingId: 'z',
    };
    expect(isAfterCursor(meeting, cursor)).toBe(true);
  });

  it('returns false when meeting timestamp is before cursor', () => {
    const meeting = {
      meetingId: 'a',
      sortTimestampMs: 500,
      date: '2026-04-09',
    };
    const cursor = {
      lastTimestampMs: 1000,
      lastDate: '2026-04-09',
      lastMeetingId: 'a',
    };
    expect(isAfterCursor(meeting, cursor)).toBe(false);
  });

  it('falls to date comparison when meeting has null timestamp', () => {
    const cursor = {
      lastTimestampMs: 5000,
      lastDate: '2026-04-08',
      lastMeetingId: 'z',
    };
    // Meeting has no timestamp but a later date — should be after cursor
    expect(
      isAfterCursor(
        { meetingId: 'a', sortTimestampMs: null, date: '2026-04-09' },
        cursor,
      ),
    ).toBe(true);
    // Meeting has no timestamp and an earlier date — should be before cursor
    expect(
      isAfterCursor(
        { meetingId: 'a', sortTimestampMs: null, date: '2026-04-07' },
        cursor,
      ),
    ).toBe(false);
  });

  it('uses meetingId as tie-breaker', () => {
    const cursor = {
      lastTimestampMs: 1000,
      lastDate: '2026-04-09',
      lastMeetingId: 'bbb',
    };
    expect(
      isAfterCursor(
        { meetingId: 'ccc', sortTimestampMs: 1000, date: '2026-04-09' },
        cursor,
      ),
    ).toBe(true);
    expect(
      isAfterCursor(
        { meetingId: 'aaa', sortTimestampMs: 1000, date: '2026-04-09' },
        cursor,
      ),
    ).toBe(false);
  });
});

describe('advanceCursor', () => {
  it('returns cursor pointing to last meeting', () => {
    const batch = [
      { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' },
      { meetingId: 'b', sortTimestampMs: 2000, date: '2026-04-10' },
    ];
    const cursor = advanceCursor(batch);
    expect(cursor).toEqual({
      lastTimestampMs: 2000,
      lastDate: '2026-04-10',
      lastMeetingId: 'b',
    });
  });

  it('returns empty cursor for empty batch', () => {
    expect(advanceCursor([])).toEqual(emptyCursor());
  });
});

describe('selectBatch', () => {
  it('selects meetings after cursor, limited by batch size', () => {
    const meetings = [
      { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' },
      { meetingId: 'b', sortTimestampMs: 2000, date: '2026-04-10' },
      { meetingId: 'c', sortTimestampMs: 3000, date: '2026-04-11' },
    ];
    const cursor = {
      lastTimestampMs: 1000,
      lastDate: '2026-04-09',
      lastMeetingId: 'a',
    };
    const batch = selectBatch(meetings, cursor, 2);
    expect(batch).toHaveLength(2);
    expect(batch[0].meetingId).toBe('b');
    expect(batch[1].meetingId).toBe('c');
  });

  it('returns all meetings for empty cursor', () => {
    const meetings = [
      { meetingId: 'a', sortTimestampMs: 1000, date: '2026-04-09' },
      { meetingId: 'b', sortTimestampMs: 2000, date: '2026-04-10' },
    ];
    const batch = selectBatch(meetings, emptyCursor(), 10);
    expect(batch).toHaveLength(2);
  });
});
