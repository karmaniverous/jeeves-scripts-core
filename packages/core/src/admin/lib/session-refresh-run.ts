/**
 * @module admin/lib/session-refresh-run
 *
 * The session refresh (`admin-refresh-sessions`): rotates idle top-level
 * Slack gateway sessions whose last cache read is over the threshold.
 * Renames each transcript to `<file>.reset.<ms>`, gives the entry a new
 * session id, writes `sessions.json` once (atomically), then notifies each
 * refreshed session through the gateway. When the write fails every rename
 * is rolled back and the run fails. Every collaborator is a parameter.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  SESSION_REFRESH_CACHE_READ_THRESHOLD,
  SESSION_REFRESH_IDLE_MINUTES,
} from '../../lib/constants.js';
import {
  getLastCacheRead,
  getLastMessageTimestamp,
  isSlackSession,
  readTailLines,
  type SessionEntry,
  type SessionsJson,
  shouldRefresh,
} from './session-inspect.js';

/** Settings read from the environment (documented in `guides/admin.md`). */
export interface SessionRefreshSettings {
  /** Minimum last-turn cache read (`CACHE_READ_THRESHOLD`). */
  cacheReadThreshold: number;
  /** Minimum idle minutes (`IDLE_MINUTES`). */
  idleMinutes: number;
  /** Session keys never refreshed (`EXCLUDED_SESSION_KEYS`, comma-separated). */
  excludedKeys: ReadonlySet<string>;
}

/** Parse the settings from an environment; unset or invalid numbers take the defaults. */
export function sessionRefreshSettings(
  env: Readonly<Record<string, string | undefined>>,
): SessionRefreshSettings {
  return {
    cacheReadThreshold:
      parseInt(env.CACHE_READ_THRESHOLD ?? '', 10) ||
      SESSION_REFRESH_CACHE_READ_THRESHOLD,
    idleMinutes:
      parseInt(env.IDLE_MINUTES ?? '', 10) || SESSION_REFRESH_IDLE_MINUTES,
    excludedKeys: new Set(
      (env.EXCLUDED_SESSION_KEYS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}

/** What {@link sessionRefresh} reads, writes and calls. */
export interface SessionRefreshDeps {
  /** OpenClaw's sessions directory (holds `sessions.json`). */
  sessionsDir: string;
  /** Gateway tool call. */
  invoke: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Clock (ms). */
  now: () => number;
  /** New session ids. */
  uuid: () => string;
  /** Thresholds and exclusions. */
  settings: SessionRefreshSettings;
}

interface Rotation {
  key: string;
  entry: SessionEntry;
  sessionFile: string;
  resetPath: string;
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const transcriptOf = (entry: SessionEntry, sessionsDir: string): string =>
  entry.sessionFile ?? path.join(sessionsDir, `${entry.sessionId}.jsonl`);

/** Rename the transcript and point the entry at a new session id. */
function rotate(
  key: string,
  entry: SessionEntry,
  deps: SessionRefreshDeps,
): Rotation {
  const sessionFile = transcriptOf(entry, deps.sessionsDir);
  const timestamp = deps.now();
  const resetPath = `${sessionFile}.reset.${String(timestamp)}`;
  fs.renameSync(sessionFile, resetPath);
  console.log(`  Renamed transcript to ${path.basename(resetPath)}`);
  const newSessionId = deps.uuid();
  entry.sessionId = newSessionId;
  entry.updatedAt = timestamp;
  if (entry.sessionFile)
    entry.sessionFile = path.join(
      path.dirname(entry.sessionFile),
      `${newSessionId}.jsonl`,
    );
  console.log(`  Updated session entry: new sessionId=${newSessionId}`);
  return { key, entry, sessionFile, resetPath };
}

/** Undo the renames after `sessions.json` could not be written. */
function rollBack(rotations: readonly Rotation[]): void {
  for (const { resetPath, sessionFile } of rotations) {
    try {
      fs.renameSync(resetPath, sessionFile);
      console.error(
        `  Rolled back transcript rename: ${path.basename(sessionFile)}`,
      );
    } catch (err) {
      console.error(`  Failed to roll back transcript rename: ${message(err)}`);
    }
  }
}

/** Tell the session's Slack target and the session itself; failures are logged only. */
async function notify(
  { key, entry }: Rotation,
  deps: SessionRefreshDeps,
): Promise<void> {
  const target = entry.origin?.nativeChannelId ?? key;
  const thresholdLabel = `>${String(Math.round(deps.settings.cacheReadThreshold / 1000))}K tokens`;
  try {
    await deps.invoke('message', {
      action: 'send',
      target,
      channel: 'slack',
      message: `\u{1f504} Session refreshed \u2014 context was getting large (${thresholdLabel}). I will recover context from memory and recent messages on next interaction.`,
    });
    console.log(`  Sent Slack notification to ${target}`);
  } catch (err) {
    console.error(`  Failed to send Slack notification: ${message(err)}`);
  }
  try {
    await deps.invoke('sessions_send', {
      sessionKey: key,
      message:
        'Context was automatically refreshed to reduce cost. On the next user message, check memory files and recent Slack history to recover conversational context.',
    });
    console.log(`  Sent recovery priming message`);
  } catch (err) {
    console.error(`  Failed to send recovery priming message: ${message(err)}`);
  }
}

/** Read `sessions.json`, or `undefined` (logged) when absent or unparseable. */
function readSessions(sessionsPath: string): SessionsJson | undefined {
  if (!fs.existsSync(sessionsPath)) {
    console.log('[session-refresh] No sessions.json found — nothing to do.');
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) as SessionsJson;
  } catch (err) {
    console.error(
      `[session-refresh] Failed to parse sessions.json: ${message(err)}`,
    );
    return undefined;
  }
}

/** Whether a session is due, logging why one is passed over. */
function isDue(
  key: string,
  entry: SessionEntry,
  now: number,
  deps: SessionRefreshDeps,
): boolean {
  const { settings } = deps;
  if (settings.excludedKeys.has(key)) {
    console.log(`[session-refresh] Skipping excluded key: ${key}`);
    return false;
  }
  if (!isSlackSession(entry)) return false;
  const sessionFile = transcriptOf(entry, deps.sessionsDir);
  if (!fs.existsSync(sessionFile)) {
    console.log(`[session-refresh] Transcript not found for ${key}, skipping`);
    return false;
  }
  const lines = readTailLines(sessionFile);
  const cacheRead = getLastCacheRead(lines);
  const lastTs = getLastMessageTimestamp(lines);
  if (lastTs === 0) return false;
  if (
    !shouldRefresh(
      cacheRead,
      lastTs,
      now,
      settings.cacheReadThreshold,
      settings.idleMinutes,
    )
  )
    return false;
  console.log(`[session-refresh] Refreshing: ${key}`);
  console.log(
    `  cacheRead=${String(cacheRead)}, idle=${String(Math.round((now - lastTs) / 60_000))}min`,
  );
  return true;
}

/**
 * Refresh every due session.
 *
 * @returns The number of sessions refreshed.
 * @throws When `sessions.json` can't be written (after rolling back every rename).
 */
export async function sessionRefresh(
  deps: SessionRefreshDeps,
): Promise<number> {
  const { settings } = deps;
  const sessionsPath = path.join(deps.sessionsDir, 'sessions.json');
  const sessions = readSessions(sessionsPath);
  if (!sessions) return 0;

  const now = deps.now();
  console.log(
    `[session-refresh] Checking sessions (threshold=${String(settings.cacheReadThreshold)}, idle=${String(settings.idleMinutes)}min)`,
  );

  const rotations: Rotation[] = [];
  for (const [key, entry] of Object.entries(sessions)) {
    // One session's error doesn't stop the others.
    try {
      if (isDue(key, entry, now, deps))
        rotations.push(rotate(key, entry, deps));
    } catch (err) {
      console.error(
        `[session-refresh] Error refreshing session ${key}: ${message(err)}`,
      );
    }
  }

  if (rotations.length > 0) {
    const tempPath = sessionsPath + '.tmp';
    try {
      fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2), 'utf8');
      fs.renameSync(tempPath, sessionsPath);
    } catch (err) {
      console.error(
        `[session-refresh] Failed to write sessions.json: ${message(err)}`,
      );
      rollBack(rotations);
      throw err;
    }
    console.log(`[session-refresh] Wrote sessions.json atomically`);
    for (const rotation of rotations) await notify(rotation, deps);
  }

  console.log(
    `[session-refresh] Done: ${String(rotations.length)} session(s) refreshed.`,
  );
  return rotations.length;
}
