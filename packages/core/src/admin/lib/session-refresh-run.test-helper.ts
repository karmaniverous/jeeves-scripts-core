/**
 * Shared harness for the session-refresh run-flow tests: fake
 * collaborators over a session list, captured console output and two due
 * sessions.
 */

import { afterEach, beforeEach, vi } from 'vitest';

import type { LastTurnUsage } from './openclaw-db/types.js';
import { minutesAgo, NOW, row, turn } from './session-refresh.fixtures.js';
import type {
  ResetOutcome,
  SessionGateway,
  SessionRow,
} from './session-refresh-gateway.js';
import type { SessionRefreshDeps } from './session-refresh-run.js';

/** A last turn over the default threshold. */
export const BIG = turn({ cacheWrite: 200_000 });

/** A due session idle for 90 minutes. */
export const dueA = row({
  key: 'agent:main:slack:channel:ca',
  sessionId: 'a',
  lastInteractionAt: minutesAgo(90),
});

/** A due session of another agent, idle longer (reset first). */
export const dueB = row({
  key: 'agent:ops:slack:channel:cb',
  sessionId: 'b',
  agentId: 'ops',
  lastInteractionAt: minutesAgo(300),
});

/** Collaborators over a list, with per-session usage by session id. */
export function depsFor(
  rows: SessionRow[],
  usage: Record<string, LastTurnUsage | undefined> = {},
  over: Partial<SessionRefreshDeps> = {},
) {
  const gateway = {
    list: vi.fn(() => Promise.resolve(rows)),
    active: vi.fn(() => Promise.resolve([] as SessionRow[])),
    describe: vi.fn((key: string) =>
      Promise.resolve(rows.find((r) => r.key === key) ?? row({ key })),
    ),
    reset: vi.fn((_key: string, _expectedSessionId: string) =>
      Promise.resolve<ResetOutcome>('reset'),
    ),
  } satisfies SessionGateway;
  const deps: SessionRefreshDeps = {
    settings: {
      contextThreshold: 150_000,
      idleMinutes: 60,
      excludedKeys: new Set(['agent:main:main']),
    },
    live: false,
    gateway,
    usage: vi.fn((_agent: string, sid: string) => usage[sid]),
    notify: vi.fn(() => Promise.resolve('posted' as const)),
    now: () => NOW,
    ...over,
  };
  return { deps, gateway };
}

/** Suite hooks capturing console.log and console.error lines. */
export function useConsoleCapture(): { logs: string[]; errors: string[] } {
  const out = { logs: [] as string[], errors: [] as string[] };
  beforeEach(() => {
    out.logs.length = 0;
    out.errors.length = 0;
    vi.spyOn(console, 'log').mockImplementation((m: string) => {
      out.logs.push(m);
    });
    vi.spyOn(console, 'error').mockImplementation((m: string) => {
      out.errors.push(m);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  return out;
}
