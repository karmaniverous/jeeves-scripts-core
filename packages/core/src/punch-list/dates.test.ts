import { describe, expect, it } from 'vitest';

import { dayIn, daysBetween } from './dates.js';

describe('dayIn', () => {
  it('uses the zone, not UTC, to pick the day', () => {
    const evening = new Date('2026-10-18T20:00:00Z');
    expect(dayIn('UTC', evening)).toBe('2026-10-18');
    expect(dayIn('Asia/Tokyo', evening)).toBe('2026-10-19');
  });
});

describe('daysBetween', () => {
  it('counts calendar days across a month end, in both directions', () => {
    expect(daysBetween('2026-09-30', '2026-10-30')).toBe(30);
    expect(daysBetween('2026-10-18', '2026-10-17')).toBe(-1);
    expect(daysBetween('2026-10-18', '2026-10-18')).toBe(0);
  });
});
