import { describe, expect, it } from 'vitest';

import { enumHours, resetCursorsForRange } from './recalc-utils.js';

// ── enumHours ───────────────────────────────────────────────────────

describe('enumHours', () => {
  it('returns empty array when from > to', () => {
    const from = Date.UTC(2025, 5, 15, 10, 0, 0);
    const to = Date.UTC(2025, 5, 15, 8, 0, 0);
    expect(enumHours(from, to)).toEqual([]);
  });

  it('returns single hour when from and to are in the same hour', () => {
    const from = Date.UTC(2025, 5, 15, 10, 15, 0);
    const to = Date.UTC(2025, 5, 15, 10, 45, 0);
    const result = enumHours(from, to);
    expect(result).toEqual(['2025-06-15T10']);
  });

  it('enumerates multiple hours', () => {
    const from = Date.UTC(2025, 5, 15, 10, 0, 0);
    const to = Date.UTC(2025, 5, 15, 13, 0, 0);
    const result = enumHours(from, to);
    expect(result).toEqual([
      '2025-06-15T10',
      '2025-06-15T11',
      '2025-06-15T12',
      '2025-06-15T13',
    ]);
  });

  it('handles cross-day boundary', () => {
    const from = Date.UTC(2025, 5, 15, 23, 0, 0);
    const to = Date.UTC(2025, 5, 16, 1, 0, 0);
    const result = enumHours(from, to);
    expect(result).toEqual(['2025-06-15T23', '2025-06-16T00', '2025-06-16T01']);
  });

  it('handles cross-month boundary', () => {
    const from = Date.UTC(2025, 5, 30, 23, 0, 0); // June 30
    const to = Date.UTC(2025, 6, 1, 1, 0, 0); // July 1
    const result = enumHours(from, to);
    expect(result).toEqual(['2025-06-30T23', '2025-07-01T00', '2025-07-01T01']);
  });

  it('truncates minutes from from timestamp', () => {
    // from is at 10:45, should start at 10:00
    const from = Date.UTC(2025, 5, 15, 10, 45, 30);
    const to = Date.UTC(2025, 5, 15, 11, 0, 0);
    const result = enumHours(from, to);
    expect(result).toEqual(['2025-06-15T10', '2025-06-15T11']);
  });
});

// ── resetCursorsForRange ────────────────────────────────────────────

describe('resetCursorsForRange', () => {
  it('returns empty object for empty cursor map', () => {
    expect(resetCursorsForRange({}, 1000)).toEqual({});
  });

  it('keeps cursors with lastTimestamp before fromMs unchanged', () => {
    const cursors = {
      'file-a.jsonl': { byteOffset: 500, lastTimestamp: 100 },
    };
    const result = resetCursorsForRange(cursors, 200);
    expect(result['file-a.jsonl']).toEqual({
      byteOffset: 500,
      lastTimestamp: 100,
    });
  });

  it('resets byteOffset to 0 for cursors at or after fromMs', () => {
    const cursors = {
      'file-b.jsonl': { byteOffset: 1234, lastTimestamp: 500 },
    };
    const result = resetCursorsForRange(cursors, 500);
    expect(result['file-b.jsonl']).toEqual({
      byteOffset: 0,
      lastTimestamp: 500,
    });
  });

  it('preserves lastTimestamp when resetting byteOffset', () => {
    const cursors = {
      'file-c.jsonl': { byteOffset: 9999, lastTimestamp: 800 },
    };
    const result = resetCursorsForRange(cursors, 600);
    expect(result['file-c.jsonl'].lastTimestamp).toBe(800);
    expect(result['file-c.jsonl'].byteOffset).toBe(0);
  });

  it('handles mixed cursors: some before, some after fromMs', () => {
    const cursors = {
      'before.jsonl': { byteOffset: 100, lastTimestamp: 50 },
      'after.jsonl': { byteOffset: 200, lastTimestamp: 300 },
      'at-boundary.jsonl': { byteOffset: 150, lastTimestamp: 200 },
    };
    const result = resetCursorsForRange(cursors, 200);

    // before: kept as-is
    expect(result['before.jsonl']).toEqual({
      byteOffset: 100,
      lastTimestamp: 50,
    });
    // after: reset
    expect(result['after.jsonl']).toEqual({
      byteOffset: 0,
      lastTimestamp: 300,
    });
    // at boundary (equal): reset
    expect(result['at-boundary.jsonl']).toEqual({
      byteOffset: 0,
      lastTimestamp: 200,
    });
  });

  it('does not mutate the original cursors object', () => {
    const cursors = {
      'file.jsonl': { byteOffset: 500, lastTimestamp: 1000 },
    };
    resetCursorsForRange(cursors, 500);
    expect(cursors['file.jsonl'].byteOffset).toBe(500);
  });
});
