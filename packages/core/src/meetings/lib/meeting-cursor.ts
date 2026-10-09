/**
 * @module meeting-cursor
 *
 * Meeting cursor and sort logic for global meetings meta steering.
 *
 * Sort order (spec section 10):
 *   1. sortTimestampMs (preferred, millisecond precision)
 *   2. date (coarse fallback when sortTimestampMs is null)
 *   3. meetingId (deterministic tie-breaker)
 *
 * Cursor keys: lastTimestampMs, lastDate, lastMeetingId.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface MeetingSortKey {
  meetingId: string;
  sortTimestampMs: number | null;
  date: string;
}

export interface MeetingCursor {
  lastTimestampMs: number | null;
  lastDate: string | null;
  lastMeetingId: string | null;
}

// ── Sort ────────────────────────────────────────────────────────────

/**
 * Compare two meetings for chronological ordering.
 *
 * Returns negative if a < b, positive if a > b, zero if equal.
 */
export function compareMeetings(a: MeetingSortKey, b: MeetingSortKey): number {
  // 1. sortTimestampMs (nulls sort last)
  if (a.sortTimestampMs != null && b.sortTimestampMs != null) {
    if (a.sortTimestampMs !== b.sortTimestampMs) {
      return a.sortTimestampMs - b.sortTimestampMs;
    }
  } else if (a.sortTimestampMs != null) {
    return -1; // a has timestamp, b doesn't → a first
  } else if (b.sortTimestampMs != null) {
    return 1; // b has timestamp, a doesn't → b first
  }

  // 2. date (string comparison, YYYY-MM-DD sorts correctly)
  if (a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }

  // 3. meetingId (deterministic tie-breaker)
  if (a.meetingId !== b.meetingId) {
    return a.meetingId < b.meetingId ? -1 : 1;
  }

  return 0;
}

/**
 * Sort meetings in chronological order.
 * Returns a new sorted array (does not mutate input).
 */
export function sortMeetings(meetings: MeetingSortKey[]): MeetingSortKey[] {
  return [...meetings].sort(compareMeetings);
}

// ── Cursor ──────────────────────────────────────────────────────────

/**
 * Check if a meeting is past (after) the current cursor position.
 * Returns true if the meeting should be processed (is after the cursor).
 */
export function isAfterCursor(
  meeting: MeetingSortKey,
  cursor: MeetingCursor,
): boolean {
  // No cursor → everything is after
  if (
    cursor.lastTimestampMs == null &&
    cursor.lastDate == null &&
    cursor.lastMeetingId == null
  ) {
    return true;
  }

  // Compare by timestamp
  if (meeting.sortTimestampMs != null && cursor.lastTimestampMs != null) {
    if (meeting.sortTimestampMs > cursor.lastTimestampMs) return true;
    if (meeting.sortTimestampMs < cursor.lastTimestampMs) return false;
    // Equal timestamp — fall through to tie-breaker
  } else if (
    meeting.sortTimestampMs != null &&
    cursor.lastTimestampMs == null
  ) {
    // Meeting has timestamp, cursor doesn't → meeting is "before" date-only items
    // This shouldn't normally happen with proper cursor advancement
    return true;
  }

  // Compare by date
  if (meeting.date && cursor.lastDate) {
    if (meeting.date > cursor.lastDate) return true;
    if (meeting.date < cursor.lastDate) return false;
  }

  // Tie-breaker: meetingId
  if (meeting.meetingId && cursor.lastMeetingId) {
    return meeting.meetingId > cursor.lastMeetingId;
  }

  return true;
}

/**
 * Advance the cursor to the last meeting in a batch.
 * Call this after successfully processing a batch.
 */
export function advanceCursor(batch: MeetingSortKey[]): MeetingCursor {
  if (batch.length === 0) {
    return { lastTimestampMs: null, lastDate: null, lastMeetingId: null };
  }

  const last = batch[batch.length - 1];
  return {
    lastTimestampMs: last.sortTimestampMs,
    lastDate: last.date,
    lastMeetingId: last.meetingId,
  };
}

/**
 * Select a batch of meetings after the cursor, sorted chronologically.
 */
export function selectBatch(
  meetings: MeetingSortKey[],
  cursor: MeetingCursor,
  batchSize: number,
): MeetingSortKey[] {
  const sorted = sortMeetings(meetings);
  const afterCursor = sorted.filter((m) => isAfterCursor(m, cursor));
  return afterCursor.slice(0, batchSize);
}

/**
 * Create an empty cursor (start from the beginning).
 */
export function emptyCursor(): MeetingCursor {
  return { lastTimestampMs: null, lastDate: null, lastMeetingId: null };
}
