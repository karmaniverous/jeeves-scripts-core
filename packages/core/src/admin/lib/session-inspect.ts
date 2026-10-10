/**
 * @module admin/lib/session-inspect
 *
 * Read-only inspection of gateway sessions for `admin/session-refresh`:
 * the `sessions.json` entry shape, which sessions qualify for a refresh,
 * and the last cache-read size and message time from the tail of a
 * session transcript.
 */

import fs from 'node:fs';

import {
  SESSION_REFRESH_CACHE_READ_THRESHOLD,
  SESSION_REFRESH_IDLE_MINUTES,
} from '../../lib/constants.js';

// ── Config ─────────────────────────────────────────────────────────────

const TAIL_BYTES = 32 * 1024;

// read last ~32KB of transcript files

// ── Types ──────────────────────────────────────────────────────────────

export interface SessionEntry {
  sessionId: string;
  channel?: string;
  chatType?: string;
  spawnDepth?: number;
  origin?: { nativeChannelId?: string; label?: string };
  sessionFile?: string;
  updatedAt?: number;
}

export type SessionsJson = Record<string, SessionEntry>;

// ── Pure helpers (exported for testing) ────────────────────────────────

/** Check if a session entry is a top-level Slack session. */
export function isSlackSession(entry: SessionEntry): boolean {
  return entry.channel === 'slack' && (entry.spawnDepth ?? 0) === 0;
}

/** Determine if a session should be refreshed based on thresholds. */
export function shouldRefresh(
  cacheRead: number,
  lastMessageMs: number,
  now: number,
  cacheReadThreshold: number = SESSION_REFRESH_CACHE_READ_THRESHOLD,
  idleMinutes: number = SESSION_REFRESH_IDLE_MINUTES,
): boolean {
  return (
    cacheRead >= cacheReadThreshold &&
    now - lastMessageMs >= idleMinutes * 60 * 1000
  );
}

/**
 * Extract cacheRead from the LAST assistant turn in JSONL lines.
 * Returns 0 if not found.
 */
export function getLastCacheRead(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;

    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'type' in parsed &&
        (parsed as Record<string, unknown>).type === 'message' &&
        'message' in parsed
      ) {
        const msg = (parsed as Record<string, unknown>).message;
        if (
          msg &&
          typeof msg === 'object' &&
          'role' in msg &&
          (msg as Record<string, unknown>).role === 'assistant' &&
          'usage' in msg
        ) {
          const usage = (msg as Record<string, unknown>).usage;
          if (
            usage &&
            typeof usage === 'object' &&
            'cacheRead' in usage &&
            typeof (usage as Record<string, unknown>).cacheRead === 'number'
          ) {
            return (usage as Record<string, unknown>).cacheRead as number;
          }
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return 0;
}

/**
 * Extract the timestamp (ms) of the last JSONL entry with a timestamp field.
 * Returns 0 if not found.
 */
export function getLastMessageTimestamp(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;

    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && 'timestamp' in parsed) {
        const ts = (parsed as Record<string, unknown>).timestamp;
        if (typeof ts === 'string') {
          const ms = new Date(ts).getTime();
          if (!isNaN(ms)) return ms;
        } else if (typeof ts === 'number') {
          return ts > 1e12 ? ts : ts * 1000;
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return 0;
}

/**
 * Read the tail of a file (last `bytes` bytes) and return lines.
 * For small files, reads the entire file.
 */
export function readTailLines(
  filePath: string,
  bytes: number = TAIL_BYTES,
): string[] {
  const stat = fs.statSync(filePath);
  if (stat.size <= bytes) {
    return fs.readFileSync(filePath, 'utf8').split('\n');
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const offset = stat.size - bytes;
    fs.readSync(fd, buf, 0, bytes, offset);
    const text = buf.toString('utf8');
    // Drop the first partial line (we likely landed mid-line)
    const firstNewline = text.indexOf('\n');
    const usable = firstNewline === -1 ? text : text.slice(firstNewline + 1);
    return usable.split('\n');
  } finally {
    fs.closeSync(fd);
  }
}
