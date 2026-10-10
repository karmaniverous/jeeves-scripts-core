/**
 * @module lib/worker-session
 *
 * Worker session tracking for `spawn-worker`: gateway response shapes,
 * run-status decisions from the `sessions_list` row, token totals from
 * the transcript, polling until the run ends, and the `WORKER_RESULT:`
 * line format other modules parse. Side effects: gateway calls and
 * transcript reads in the default deps only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gatewayInvoke } from './gateway-client.js';

/**
 * Log a warning (never a completion) when a running session has not
 * updated for this long.
 */
const QUIET_WARNING_MS = 60_000;

/** Session-row run statuses that mean the run failed. */
const FAILED_STATUSES = ['failed', 'killed', 'timeout'];

// ── Types ──────────────────────────────────────────────────────────────

/** A gateway tool response (the shapes `sessions_spawn` / `sessions_list` return). */
export interface GatewayResponse {
  ok?: boolean;
  result?: GatewayResult;
  details?: GatewayResult;
  sessions?: GatewaySession[];
  error?: { message?: string };
}

/** The `result` of a gateway tool response. */
export interface GatewayResult {
  details?: GatewayDetails;
  sessions?: GatewaySession[];
}

/** The `details` of a gateway tool result. */
export interface GatewayDetails {
  sessions?: GatewaySession[];
  childSessionKey?: string;
  sessionKey?: string;
}

/** One `sessions_list` row (only the fields used here). */
export interface GatewaySession {
  key: string;
  /** Run status: running | done | failed | killed | timeout. */
  status?: string;
  updatedAt?: number;
  totalTokens?: number;
  transcriptPath?: string;
  model?: string;
}

/** Outcome of {@link isSessionCompleted}. */
export interface SessionStatus {
  completed: boolean;
  /** Set when the run ended unsuccessfully. */
  error?: string;
}

/** Injectable I/O for {@link waitForWorkerCompletion}. */
export interface WaitDeps {
  findSession: (sessionKey: string) => Promise<GatewaySession | undefined>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  tokensFor: (session: GatewaySession) => number;
}

/** Outcome of {@link waitForWorkerCompletion}. */
export interface WorkerCompletion {
  success: boolean;
  durationMs: number;
  tokens: number;
  model?: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────

/**
 * Decide whether a worker run has ended, from the gateway's own run
 * status on its `sessions_list` row (never from transcript inactivity:
 * a worker writing a long final reply persists nothing until it ends).
 *
 * - `done` → completed.
 * - `failed` / `killed` / `timeout` → completed with an error.
 * - anything else (`running`, not yet projected, row missing) → running.
 */
export function isSessionCompleted(
  session: GatewaySession | undefined,
): SessionStatus {
  const status = session?.status;
  if (status === 'done') return { completed: true };
  if (status && FAILED_STATUSES.includes(status)) {
    return { completed: true, error: `Worker run ended: status=${status}` };
  }
  return { completed: false };
}

/**
 * Sum totalTokens from each JSON-Lines entry in a transcript file.
 */
export function getTokensFromTranscript(transcriptPath: string): number {
  try {
    if (!fs.existsSync(transcriptPath)) return 0;

    const lines = fs
      .readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim());
    let total = 0;

    for (const line of lines) {
      try {
        const entry: unknown = JSON.parse(line);
        if (
          entry &&
          typeof entry === 'object' &&
          'message' in entry &&
          entry.message &&
          typeof entry.message === 'object' &&
          'usage' in entry.message &&
          entry.message.usage &&
          typeof entry.message.usage === 'object' &&
          'totalTokens' in entry.message.usage &&
          typeof entry.message.usage.totalTokens === 'number'
        ) {
          total += entry.message.usage.totalTokens;
        }
      } catch {
        /* skip non-JSON lines */
      }
    }

    return total;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[${new Date().toISOString()}] Failed to read transcript: ${msg}`,
    );
    return 0;
  }
}

/**
 * Parse WORKER_RESULT lines from spawn-worker output.
 */
export function parseResultLine(line: string): {
  sessionKey: string;
  tokens: number;
  durationMs: number;
  model?: string;
} | null {
  const prefix = 'WORKER_RESULT:';
  if (!line.startsWith(prefix)) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(prefix.length));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'sessionKey' in parsed &&
      'tokens' in parsed &&
      'durationMs' in parsed
    ) {
      const r = parsed as {
        sessionKey: string;
        tokens: number;
        durationMs: number;
        model?: string;
      };
      return r;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Gateway I/O ───────────────────────────────────────────────────────

/** Invoke a gateway tool, wrapped in the response shape the parsers expect. */
export async function invokeGateway(
  tool: string,
  toolArgs: Record<string, unknown>,
): Promise<GatewayResponse> {
  const result = await gatewayInvoke(tool, toolArgs);
  return { ok: true, result: result as GatewayResult };
}

// ── Session helpers ───────────────────────────────────────────────────

function getSessionsDir(): string {
  const home = process.env.USERPROFILE ?? os.homedir();
  const configDirs = [
    path.join(home, '.openclaw'),
    path.join(home, '.clawdbot'),
  ];
  for (const dir of configDirs) {
    const sessDir = path.join(dir, 'agents', 'main', 'sessions');
    if (fs.existsSync(sessDir)) return sessDir;
  }
  return path.join(home, '.openclaw', 'agents', 'main', 'sessions');
}

/** Resolve a session row's token count (transcript usage preferred). */
function sessionTokens(session: GatewaySession): number {
  let totalTokens = session.totalTokens ?? 0;
  if (session.transcriptPath) {
    const fullPath = path.isAbsolute(session.transcriptPath)
      ? session.transcriptPath
      : path.join(getSessionsDir(), session.transcriptPath);
    const transcriptTokens = getTokensFromTranscript(fullPath);
    if (transcriptTokens > 0) totalTokens = transcriptTokens;
  }
  return totalTokens;
}

/** Fetch one session's `sessions_list` row by exact key. */
async function findSession(
  sessionKey: string,
): Promise<GatewaySession | undefined> {
  const result = await invokeGateway('sessions_list', {
    search: sessionKey,
    limit: 20,
  });
  const sessions: GatewaySession[] =
    result.result?.details?.sessions ??
    result.result?.sessions ??
    result.sessions ??
    [];
  return sessions.find((s) => s.key === sessionKey);
}

const defaultWaitDeps: WaitDeps = {
  findSession,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  tokensFor: sessionTokens,
};

/**
 * Poll the worker session until the gateway reports its run ended. The
 * runner job timeout (which kills this process) is the upper bound.
 *
 * @throws Error when the run ends failed/killed/timeout.
 */
export async function waitForWorkerCompletion(
  sessionKey: string,
  startTime: number,
  deps: WaitDeps = defaultWaitDeps,
): Promise<WorkerCompletion> {
  const pollInterval = 5000;

  // Initial delay to let the session start
  await deps.sleep(3000);

  for (;;) {
    let session: GatewaySession | undefined;
    try {
      session = await deps.findSession(sessionKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] Poll failed: ${msg}`);
    }

    const status = isSessionCompleted(session);
    if (status.error) throw new Error(status.error);

    if (status.completed && session) {
      const durationMs = deps.now() - startTime;
      const tokens = deps.tokensFor(session);
      console.log(
        `[${new Date().toISOString()}] Session run done: tokens=${String(tokens)}, model=${session.model ?? 'unknown'}`,
      );
      return { success: true, durationMs, tokens, model: session.model };
    }

    const label = session?.status ?? (session ? 'none' : 'not found');
    const quietMs = session?.updatedAt ? deps.now() - session.updatedAt : 0;
    const quiet =
      quietMs > QUIET_WARNING_MS
        ? ` (warning: no update for ${String(Math.round(quietMs / 1000))}s; still waiting for run end)`
        : '';
    console.log(
      `[${new Date().toISOString()}] Session still running (status: ${label})${quiet}`,
    );

    await deps.sleep(pollInterval);
  }
}
