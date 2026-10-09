/**
 * Tests for session-refresh pure logic functions.
 * Does NOT test gateway calls — only threshold logic and JSONL parsing.
 */

import { describe, expect, it } from 'vitest';

import {
  SESSION_REFRESH_CACHE_READ_THRESHOLD,
  SESSION_REFRESH_IDLE_MINUTES,
} from '../lib/constants.js';
import type { SessionEntry } from './session-refresh.js';
import {
  getLastCacheRead,
  getLastMessageTimestamp,
  isSlackSession,
  shouldRefresh,
} from './session-refresh.js';

// ── isSlackSession ─────────────────────────────────────────────────────

describe('isSlackSession', () => {
  it('returns true for top-level Slack session', () => {
    const entry: SessionEntry = {
      sessionId: 'abc',
      channel: 'slack',
      spawnDepth: 0,
    };
    expect(isSlackSession(entry)).toBe(true);
  });

  it('returns true when spawnDepth is undefined (defaults to 0)', () => {
    const entry: SessionEntry = {
      sessionId: 'abc',
      channel: 'slack',
    };
    expect(isSlackSession(entry)).toBe(true);
  });

  it('returns false for subagent (spawnDepth > 0)', () => {
    const entry: SessionEntry = {
      sessionId: 'abc',
      channel: 'slack',
      spawnDepth: 1,
    };
    expect(isSlackSession(entry)).toBe(false);
  });

  it('returns false for non-slack channel', () => {
    const entry: SessionEntry = {
      sessionId: 'abc',
      channel: undefined,
    };
    expect(isSlackSession(entry)).toBe(false);
  });
});

// ── shouldRefresh ──────────────────────────────────────────────────────

describe('shouldRefresh', () => {
  const threshold = SESSION_REFRESH_CACHE_READ_THRESHOLD;
  const idleMin = SESSION_REFRESH_IDLE_MINUTES;
  const idleMs = idleMin * 60 * 1000;

  it('returns true when both conditions met', () => {
    const now = 1_000_000_000;
    const lastMsg = now - idleMs - 1;
    expect(shouldRefresh(threshold, lastMsg, now, threshold, idleMin)).toBe(
      true,
    );
  });

  it('returns false when cacheRead is below threshold', () => {
    const now = 1_000_000_000;
    const lastMsg = now - idleMs - 1;
    expect(shouldRefresh(threshold - 1, lastMsg, now, threshold, idleMin)).toBe(
      false,
    );
  });

  it('returns false when session is not idle enough', () => {
    const now = 1_000_000_000;
    const lastMsg = now - idleMs + 60_000; // 1 minute short
    expect(shouldRefresh(threshold, lastMsg, now, threshold, idleMin)).toBe(
      false,
    );
  });

  it('returns true at exact boundary', () => {
    const now = 1_000_000_000;
    const lastMsg = now - idleMs;
    expect(shouldRefresh(threshold, lastMsg, now, threshold, idleMin)).toBe(
      true,
    );
  });
});

// ── getLastCacheRead ───────────────────────────────────────────────────

describe('getLastCacheRead', () => {
  it('extracts cacheRead from last assistant message', () => {
    const lines = [
      JSON.stringify({
        type: 'session',
        id: 's1',
        timestamp: '2025-01-01T00:00:00Z',
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          usage: { cacheRead: 50000, input: 100, output: 200 },
        },
        timestamp: '2025-01-01T00:01:00Z',
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          usage: { cacheRead: 160000, input: 100, output: 200 },
        },
        timestamp: '2025-01-01T00:02:00Z',
      }),
    ];
    expect(getLastCacheRead(lines)).toBe(160000);
  });

  it('skips non-assistant messages', () => {
    const lines = [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          usage: { cacheRead: 80000, input: 100, output: 200 },
        },
        timestamp: '2025-01-01T00:01:00Z',
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user' },
        timestamp: '2025-01-01T00:02:00Z',
      }),
    ];
    expect(getLastCacheRead(lines)).toBe(80000);
  });

  it('returns 0 for empty lines', () => {
    expect(getLastCacheRead([])).toBe(0);
  });

  it('returns 0 when no assistant messages exist', () => {
    const lines = [
      JSON.stringify({
        type: 'session',
        id: 's1',
        timestamp: '2025-01-01T00:00:00Z',
      }),
    ];
    expect(getLastCacheRead(lines)).toBe(0);
  });
});

// ── getLastMessageTimestamp ─────────────────────────────────────────────

describe('getLastMessageTimestamp', () => {
  it('extracts ISO string timestamp', () => {
    const lines = [
      JSON.stringify({
        type: 'session',
        id: 's1',
        timestamp: '2025-01-01T00:00:00Z',
      }),
      JSON.stringify({
        type: 'message',
        message: { role: 'user' },
        timestamp: '2025-06-15T12:30:00Z',
      }),
    ];
    const expected = new Date('2025-06-15T12:30:00Z').getTime();
    expect(getLastMessageTimestamp(lines)).toBe(expected);
  });

  it('extracts numeric timestamp in ms', () => {
    const ts = 1718451000000;
    const lines = [
      JSON.stringify({
        type: 'message',
        message: { role: 'user' },
        timestamp: ts,
      }),
    ];
    expect(getLastMessageTimestamp(lines)).toBe(ts);
  });

  it('converts seconds to ms', () => {
    const tsSec = 1718451000;
    const lines = [
      JSON.stringify({
        type: 'message',
        message: { role: 'user' },
        timestamp: tsSec,
      }),
    ];
    expect(getLastMessageTimestamp(lines)).toBe(tsSec * 1000);
  });

  it('returns 0 for empty lines', () => {
    expect(getLastMessageTimestamp([])).toBe(0);
  });

  it('returns last timestamp even if from a session header', () => {
    const lines = [
      JSON.stringify({
        type: 'session',
        id: 's1',
        timestamp: '2025-01-01T00:00:00Z',
      }),
    ];
    const expected = new Date('2025-01-01T00:00:00Z').getTime();
    expect(getLastMessageTimestamp(lines)).toBe(expected);
  });
});

// ── Excluded session keys ──────────────────────────────────────────────

describe('excluded session keys filtering', () => {
  it('Set-based exclusion works correctly', () => {
    const excludedKeys = new Set(['slack:direct:U123', 'slack:channel:C456']);
    expect(excludedKeys.has('slack:direct:U123')).toBe(true);
    expect(excludedKeys.has('slack:channel:C789')).toBe(false);
  });

  it('parses comma-separated env var correctly', () => {
    const envVal = 'slack:direct:U123, slack:channel:C456 ,slack:direct:U789';
    const excluded = new Set(
      envVal
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    expect(excluded.size).toBe(3);
    expect(excluded.has('slack:direct:U123')).toBe(true);
    expect(excluded.has('slack:channel:C456')).toBe(true);
    expect(excluded.has('slack:direct:U789')).toBe(true);
  });

  it('handles empty env var', () => {
    const envVal = '';
    const excluded = new Set(
      envVal
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    expect(excluded.size).toBe(0);
  });
});
