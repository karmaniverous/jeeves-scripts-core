#!/usr/bin/env tsx
/**
 * @module session-refresh
 *
 * Session Refresh — automatically rotates bloated gateway sessions
 * to reduce cost by resetting sessions with high cacheRead values
 * that have been idle long enough.
 *
 * Designed as a runner cron job. Uses gateway tools (sessions_list,
 * sessions_reset) to inspect and rotate sessions.
 *
 * Config dependencies: SESSION_REFRESH_CACHE_READ_THRESHOLD,
 * SESSION_REFRESH_IDLE_MINUTES, GATEWAY_HOST, GATEWAY_PORT from constants.ts.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import {
  constants,
  SESSION_REFRESH_CACHE_READ_THRESHOLD,
  SESSION_REFRESH_IDLE_MINUTES,
} from '../lib/constants.js';
import { gatewayInvoke } from '../lib/gateway-client.js';

// ── Config ─────────────────────────────────────────────────────────────

const TAIL_BYTES = 32 * 1024; // read last ~32KB of transcript files

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

export interface SessionsJson {
  [key: string]: SessionEntry;
}

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
    const line = lines[i].trim();
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
    const line = lines[i].trim();
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
function readTailLines(filePath: string, bytes: number = TAIL_BYTES): string[] {
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

// ── Gateway I/O ────────────────────────────────────────────────────────

async function invokeGateway(
  tool: string,
  toolArgs: Record<string, unknown>,
): Promise<void> {
  await gatewayInvoke(tool, toolArgs);
}

// ── Core logic ─────────────────────────────────────────────────────────

async function refreshSession(
  sessionKey: string,
  sessions: SessionsJson,
  cacheRead: number,
  idleMs: number,
  cacheReadThreshold: number,
): Promise<void> {
  // Guard for missing session key
  const entry = sessions[sessionKey] as SessionEntry | undefined;
  if (!entry) {
    console.warn(
      `[session-refresh] Session key "${sessionKey}" not found in sessions.json, skipping`,
    );
    return;
  }

  const sessionFile =
    entry.sessionFile ??
    path.join(constants().SESSIONS_DIR, `${entry.sessionId}.jsonl`);
  const timestamp = Date.now();

  // a. Rename the JSONL file
  const resetPath = `${sessionFile}.reset.${String(timestamp)}`;
  fs.renameSync(sessionFile, resetPath);
  console.log(`  Renamed transcript to ${path.basename(resetPath)}`);

  // Save old values for rollback
  const oldSessionId = entry.sessionId;
  const oldSessionFile = entry.sessionFile;
  const oldUpdatedAt = entry.updatedAt;

  try {
    // b. Generate new UUID and update sessions object
    const newSessionId = crypto.randomUUID();
    entry.sessionId = newSessionId;
    entry.updatedAt = timestamp;
    if (entry.sessionFile) {
      entry.sessionFile = path.join(
        path.dirname(entry.sessionFile),
        `${newSessionId}.jsonl`,
      );
    }

    console.log(`  Updated session entry: new sessionId=${newSessionId}`);

    // c. Send Slack notification with dynamic threshold
    const target = entry.origin?.nativeChannelId ?? sessionKey;
    const thresholdLabel = `>${String(Math.round(cacheReadThreshold / 1000))}K tokens`;
    try {
      await invokeGateway('message', {
        action: 'send',
        target,
        channel: 'slack',
        message: `\u{1f504} Session refreshed \u2014 context was getting large (${thresholdLabel}). I will recover context from memory and recent messages on next interaction.`,
      });
      console.log(`  Sent Slack notification to ${target}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to send Slack notification: ${msg}`);
    }

    // d. Send recovery priming message
    try {
      await invokeGateway('sessions_send', {
        sessionKey,
        message:
          'Context was automatically refreshed to reduce cost. On the next user message, check memory files and recent Slack history to recover conversational context.',
      });
      console.log(`  Sent recovery priming message`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to send recovery priming message: ${msg}`);
    }

    const idleMin = Math.round(idleMs / 60_000);
    console.log(`  cacheRead=${String(cacheRead)}, idle=${String(idleMin)}min`);
  } catch (err: unknown) {
    // Rollback: restore transcript and session entry
    entry.sessionId = oldSessionId;
    entry.sessionFile = oldSessionFile;
    entry.updatedAt = oldUpdatedAt;
    try {
      fs.renameSync(resetPath, sessionFile);
      console.error(`  Rolled back transcript rename due to error`);
    } catch (rollbackErr: unknown) {
      const rollbackMsg =
        rollbackErr instanceof Error
          ? rollbackErr.message
          : String(rollbackErr);
      console.error(`  Failed to roll back transcript rename: ${rollbackMsg}`);
    }
    throw err;
  }
}

async function sessionRefresh(): Promise<void> {
  const cacheReadThreshold =
    parseInt(process.env['CACHE_READ_THRESHOLD'] ?? '', 10) ||
    SESSION_REFRESH_CACHE_READ_THRESHOLD;

  const idleMinutes =
    parseInt(process.env['IDLE_MINUTES'] ?? '', 10) ||
    SESSION_REFRESH_IDLE_MINUTES;

  const excludedKeys = new Set(
    (process.env['EXCLUDED_SESSION_KEYS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const sessionsPath = path.join(constants().SESSIONS_DIR, 'sessions.json');
  if (!fs.existsSync(sessionsPath)) {
    console.log('[session-refresh] No sessions.json found — nothing to do.');
    return;
  }

  // Single read of sessions.json
  let sessions: SessionsJson;
  try {
    const sessionsRaw: unknown = JSON.parse(
      fs.readFileSync(sessionsPath, 'utf8'),
    );
    sessions = sessionsRaw as SessionsJson;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[session-refresh] Failed to parse sessions.json: ${msg}`);
    return;
  }

  const now = Date.now();
  let refreshed = 0;

  console.log(
    `[session-refresh] Checking sessions (threshold=${String(cacheReadThreshold)}, idle=${String(idleMinutes)}min)`,
  );

  for (const [key, entry] of Object.entries(sessions)) {
    if (excludedKeys.has(key)) {
      console.log(`[session-refresh] Skipping excluded key: ${key}`);
      continue;
    }

    if (!isSlackSession(entry)) continue;

    const sessionFile =
      entry.sessionFile ??
      path.join(constants().SESSIONS_DIR, `${entry.sessionId}.jsonl`);
    if (!fs.existsSync(sessionFile)) {
      console.log(
        `[session-refresh] Transcript not found for ${key}, skipping`,
      );
      continue;
    }

    // Read only the tail of large transcripts
    const lines = readTailLines(sessionFile);
    const cacheRead = getLastCacheRead(lines);
    const lastTs = getLastMessageTimestamp(lines);

    if (lastTs === 0) continue;

    const idleMs = now - lastTs;

    // Try-catch so one session error doesn't kill the script
    try {
      if (
        shouldRefresh(cacheRead, lastTs, now, cacheReadThreshold, idleMinutes)
      ) {
        console.log(`[session-refresh] Refreshing: ${key}`);
        await refreshSession(
          key,
          sessions,
          cacheRead,
          idleMs,
          cacheReadThreshold,
        );
        refreshed++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[session-refresh] Error refreshing session ${key}: ${msg}`,
      );
    }
  }

  // Single atomic write of sessions.json after all refreshes
  if (refreshed > 0) {
    const tempPath = sessionsPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2), 'utf8');
    fs.renameSync(tempPath, sessionsPath);
    console.log(`[session-refresh] Wrote sessions.json atomically`);
  }

  console.log(
    `[session-refresh] Done: ${String(refreshed)} session(s) refreshed.`,
  );
}

runScript('session-refresh', sessionRefresh);
