/**
 * @module admin/lib/hour-range
 *
 * Hour-range helpers for token-metrics regeneration (regen-run): the
 * hour keys in a range and resetting cursors to re-read it.
 */

import type { CursorState } from '../types/token-metrics.js';
import { tsToHour } from './bucket-io.js';

/**
 * Enumerate all UTC hour keys between `fromMs` and `toMs` (inclusive).
 */
export function enumHours(fromMs: number, toMs: number): string[] {
  const hours: string[] = [];
  const cursor = new Date(fromMs);
  cursor.setUTCMinutes(0, 0, 0);
  const end = new Date(toMs);

  while (cursor.getTime() <= end.getTime()) {
    hours.push(tsToHour(cursor.getTime()));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return hours;
}

/**
 * Reset cursors for a targeted time range.
 *
 * Cursors whose `lastTimestamp` is before `fromMs` are kept as-is.
 * Cursors at or after `fromMs` have their `byteOffset` reset to 0
 * so the file is re-scanned from the start.
 */
export function resetCursorsForRange(
  cursors: CursorState,
  fromMs: number,
): CursorState {
  const reset: CursorState = {};
  for (const [key, cursor] of Object.entries(cursors)) {
    if (cursor.lastTimestamp < fromMs) {
      reset[key] = cursor;
    } else {
      reset[key] = { byteOffset: 0, lastTimestamp: cursor.lastTimestamp };
    }
  }
  return reset;
}
