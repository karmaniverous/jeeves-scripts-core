/**
 * @module admin/lib/session-refresh-run
 *
 * The session refresh (`admin-refresh-sessions`, spec 2.12): orchestration
 * only. Lists every session through the gateway, applies the pure rules
 * (`session-refresh-select`: scope, exclusion, busy, idle, trigger) with
 * each in-scope session's last-turn usage from the agent DB, then either
 * logs what it would reset (dry run) or, oldest activity first, re-checks
 * each due session with `sessions.describe` and the active list
 * (`sessions.list` with `activeOnly: true`, since describe can omit the
 * busy fields) and resets it with `sessions.reset` fenced by
 * `expectedSessionId`, posting the Slack notice
 * after a successful reset. A failed list, a malformed result or an
 * unreadable agent DB throws (the run fails); a failed reset is counted,
 * the rest are still tried, and the caller fails the run. A dry run makes
 * neither re-check: its rows come straight from `sessions.list`, whose
 * `hasActiveRun` is authoritative, so the preview already applies the
 * busy test. Every collaborator is a parameter.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import type { LastTurnUsage } from './openclaw-db/types.js';
import type { SessionGateway, SessionRow } from './session-refresh-gateway.js';
import {
  agentOf,
  busyOf,
  decide,
  type Decision,
  type Due,
  type OutOfScope,
  type RefreshSettings,
  scopeOf,
  type Skip,
  skip,
} from './session-refresh-select.js';

/** The log prefix. */
const TAG = '[session-refresh]';

/** What {@link sessionRefresh} reads and calls. */
export interface SessionRefreshDeps {
  /** Threshold, idle minutes and excluded keys. */
  settings: RefreshSettings;
  /** Reset (`--live`); otherwise a dry run that writes nothing. */
  live: boolean;
  /** `sessions.list` (all, or active only), `sessions.describe`, `sessions.reset`. */
  gateway: SessionGateway;
  /** A session's last-turn usage from its agent's DB (throws when the DB can't be read). */
  usage: (agentId: string, sessionId: string) => LastTurnUsage | undefined;
  /** Post the Slack notice for a reset session (`none` for a non-Slack session). */
  notify: (row: SessionRow) => Promise<'posted' | 'none'>;
  /** Clock (ms). */
  now: () => number;
}

/** What one run did. */
export interface RefreshSummary {
  listed: number;
  inScope: number;
  due: number;
  reset: number;
  /** In-scope skips by reason. */
  skipped: Map<string, number>;
  /** Out-of-scope rows by class. */
  outOfScope: Map<OutOfScope, number>;
  /** Re-checks or resets that failed. */
  failed: number;
  /** Notices that failed after a successful reset. */
  noticeFailed: number;
}

interface DueSession {
  row: SessionRow;
  usage: LastTurnUsage | undefined;
  due: Due;
}

/** The re-check found, or the gateway's fence reported, a changed session. */
const CHANGED = skip('changed', 'changed');

/** The active list (`activeOnly: true`) holds the session. */
const LISTED_ACTIVE = skip('busy', 'busy (active run, list)');

const bump = <K>(map: Map<K, number>, key: K): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const unknownNote = (d: Decision): string =>
  d.ownershipUnknown ? ', ownership unknown' : '';

const counts = (map: ReadonlyMap<string, number>): string =>
  [...map].map(([k, n]) => `${k} ${String(n)}`).join(', ') || 'none';

function logSkip(key: string, skip: Skip, summary: RefreshSummary): void {
  console.log(`${TAG} skip ${key}: ${skip.detail}${unknownNote(skip)}`);
  bump(summary.skipped, skip.reason);
}

function describeDue({ row, due }: DueSession, session = 'session'): string {
  return `${row.key} (context ${String(due.total)}, idle ${String(due.idleMin)} min, ${session} ${row.sessionId}${unknownNote(due)})`;
}

/** Steps 3-6: the in-scope decision for one listed row. */
function select(
  row: SessionRow,
  deps: SessionRefreshDeps,
  now: number,
  summary: RefreshSummary,
): DueSession | undefined {
  const scope = scopeOf(row, deps.settings);
  if (scope === 'excluded') {
    logSkip(row.key, skip('excluded', 'excluded'), summary);
    return undefined;
  }
  if (scope !== 'in') {
    bump(summary.outOfScope, scope);
    return undefined;
  }
  summary.inScope++;
  // Busy before usage: a busy session's agent DB is never read.
  const { busy, ownershipUnknown } = busyOf(row);
  if (busy) {
    logSkip(row.key, skip('busy', busy, ownershipUnknown), summary);
    return undefined;
  }
  const agentId = agentOf(row);
  if (!agentId) throw new Error(`${TAG} no agent for session ${row.key}`);
  const usage = deps.usage(agentId, row.sessionId);
  const decision = decide(row, usage, deps.settings, now);
  if (decision.kind === 'skip') {
    logSkip(row.key, decision, summary);
    return undefined;
  }
  return { row, usage, due: decision };
}

/** Step 8-9 for one due session: re-check, reset, notice. */
async function resetOne(
  session: DueSession,
  deps: SessionRefreshDeps,
  summary: RefreshSummary,
): Promise<void> {
  const { row, usage } = session;
  try {
    const fresh = await deps.gateway.describe(row.key);
    if (fresh.sessionId !== row.sessionId) {
      logSkip(row.key, CHANGED, summary);
      return;
    }
    const recheck = decide(fresh, usage, deps.settings, deps.now());
    if (recheck.kind === 'skip') {
      logSkip(row.key, recheck, summary);
      return;
    }
    if ((await deps.gateway.activeKeys()).has(row.key)) {
      logSkip(row.key, LISTED_ACTIVE, summary);
      return;
    }
    if ((await deps.gateway.reset(row.key, row.sessionId)) === 'changed') {
      logSkip(row.key, CHANGED, summary);
      return;
    }
    summary.reset++;
    console.log(
      `${TAG} reset ${describeDue({ row, usage, due: recheck }, 'old session')}`,
    );
  } catch (err) {
    summary.failed++;
    console.error(`${TAG} failed ${row.key}: ${getErrorMessage(err)}`);
    return;
  }
  try {
    if ((await deps.notify(row)) === 'posted')
      console.log(`${TAG} notice posted for ${row.key}`);
  } catch (err) {
    summary.noticeFailed++;
    console.error(`${TAG} notice failed ${row.key}: ${getErrorMessage(err)}`);
  }
}

/** The one summary line (behaviour 10). */
export function summaryLine(s: RefreshSummary): string {
  return `session-refresh: ${String(s.listed)} listed, ${String(s.inScope)} in scope, ${String(s.due)} due, ${String(s.reset)} reset, skipped: ${counts(s.skipped)}; failed ${String(s.failed)}; notice failed ${String(s.noticeFailed)}`;
}

/**
 * Run the session refresh.
 *
 * @returns What the run did; the caller fails the run when `failed > 0`.
 * @throws When the list fails or is malformed, or an agent DB can't be read.
 */
export async function sessionRefresh(
  deps: SessionRefreshDeps,
): Promise<RefreshSummary> {
  const { settings } = deps;
  console.log(
    `${TAG} ${deps.live ? 'live' : 'dry run'}: threshold ${String(settings.contextThreshold)}, idle ${String(settings.idleMinutes)} min, ${String(settings.excludedKeys.size)} excluded key(s)`,
  );
  const rows = await deps.gateway.list();
  console.log(`${TAG} ${String(rows.length)} sessions`);
  const summary: RefreshSummary = {
    listed: rows.length,
    inScope: 0,
    due: 0,
    reset: 0,
    skipped: new Map(),
    outOfScope: new Map(),
    failed: 0,
    noticeFailed: 0,
  };
  const now = deps.now();
  const due = rows
    .map((row) => select(row, deps, now, summary))
    .filter((d): d is DueSession => d !== undefined)
    .sort((a, b) => a.due.lastActivityMs - b.due.lastActivityMs);
  summary.due = due.length;
  if (summary.outOfScope.size)
    console.log(`${TAG} out of scope: ${counts(summary.outOfScope)}`);
  for (const session of due) {
    if (deps.live) await resetOne(session, deps, summary);
    else console.log(`${TAG} would reset ${describeDue(session)}`);
  }
  console.log(summaryLine(summary));
  return summary;
}
