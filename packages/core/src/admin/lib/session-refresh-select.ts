/**
 * @module admin/lib/session-refresh-select
 *
 * The pure rules of session refresh (spec 2.12, behaviour 3-6): which
 * sessions are in scope, which are excluded, busy or recently active, and
 * which carry a last-turn context at or above the threshold. Each rule
 * returns a decision with its reason; nothing here reads or writes.
 */

import type { LastTurnUsage } from './openclaw-db/types.js';
import type { SessionRow } from './session-refresh-gateway.js';

/** The job's settings (the delta fields, defaults applied). */
export interface RefreshSettings {
  /** Last-turn `input + cacheRead + cacheWrite` at or above which a session is due. */
  contextThreshold: number;
  /** Minutes since the last activity before a session may be reset. */
  idleMinutes: number;
  /** Full session keys never reset. */
  excludedKeys: ReadonlySet<string>;
}

/** Why a row is out of scope (counted per class, not logged one by one). */
export type OutOfScope =
  'subagent' | 'cron' | 'spawned' | 'unknown' | 'global' | 'archived';

/** The scope verdict for one row. */
export type Scope = OutOfScope | 'excluded' | 'in';

/** A session the job passes over, with the reason it logs. */
export interface Skip {
  kind: 'skip';
  /** The counted reason (`busy`, `recently active`, `small`, ...). */
  reason: string;
  /** The logged detail, e.g. `busy (active run)`. */
  detail: string;
  /** The row carries no activity field (the idle test decided). */
  ownershipUnknown: boolean;
}

/** A session the job resets. */
export interface Due {
  kind: 'due';
  /** The last turn's context tokens. */
  total: number;
  /** Whole minutes since the last activity. */
  idleMin: number;
  /** The latest activity (ms), for oldest-first ordering. */
  lastActivityMs: number;
  /** The row carries no activity field (the idle test decided). */
  ownershipUnknown: boolean;
}

/** The decision for one in-scope row. */
export type Decision = Skip | Due;

const MINUTE_MS = 60_000;

/** The parts of an `agent:<id>:<rest>` key, or undefined for another shape. */
export function parseKey(
  key: string,
): { agentId: string; rest: string } | undefined {
  const m = /^agent:([^:]+):(.+)$/.exec(key);
  return m ? { agentId: m[1]!, rest: m[2]! } : undefined;
}

/** The row's agent: its `agentId`, else the key's. */
export function agentOf(row: SessionRow): string | undefined {
  return row.agentId ?? parseKey(row.key)?.agentId;
}

/**
 * Whether a row is in scope: every top-level session of every agent,
 * including `agent:<id>:main` and DMs on any channel. Out: subagent and
 * cron keys, spawn lineage, the `unknown` sentinel and `global` (raw or
 * agent-qualified), and archived rows. An in-scope key in `excludedKeys`
 * is `excluded`.
 */
export function scopeOf(row: SessionRow, settings: RefreshSettings): Scope {
  const rest = parseKey(row.key)?.rest ?? row.key;
  const kind = rest.split(':')[0];
  if (row.archived === true) return 'archived';
  if (kind === 'subagent') return 'subagent';
  if (kind === 'cron') return 'cron';
  if (rest === 'unknown') return 'unknown';
  if (rest === 'global') return 'global';
  if (row.spawnedBy || row.parentSessionKey || (row.spawnDepth ?? 0) > 0)
    return 'spawned';
  return settings.excludedKeys.has(row.key) ? 'excluded' : 'in';
}

/** The busy verdict: a reason when busy, and whether ownership is unknown. */
export function busyOf(row: SessionRow): {
  busy?: string;
  ownershipUnknown: boolean;
} {
  const ids = row.activeRunIds;
  const ownershipUnknown =
    typeof row.hasActiveRun !== 'boolean' && !Array.isArray(ids);
  if (row.hasActiveRun === true || (ids && ids.length > 0))
    return { busy: 'busy (active run)', ownershipUnknown };
  const state = row.placement?.state;
  if (state && state !== 'local')
    return { busy: `busy (placement ${state})`, ownershipUnknown };
  return { ownershipUnknown };
}

/** The latest of the row's activity times and the last turn's time, if any. */
export function lastActivityOf(
  row: SessionRow,
  usage: LastTurnUsage | undefined,
): number | undefined {
  const times = [row.lastActivityAt, row.lastInteractionAt, usage?.tsMs].filter(
    (t): t is number => typeof t === 'number' && Number.isFinite(t),
  );
  return times.length ? Math.max(...times) : undefined;
}

/** A last turn's context tokens. */
export const contextOf = (usage: LastTurnUsage): number =>
  usage.input + usage.cacheRead + usage.cacheWrite;

const skip = (
  reason: string,
  detail: string,
  ownershipUnknown: boolean,
): Skip => ({ kind: 'skip', reason, detail, ownershipUnknown });

/**
 * Decide an in-scope row (behaviour 4-6): busy, then idle on the latest
 * activity, then the last turn's usage against the threshold. Also the
 * live re-check, on the freshly described row with the same usage.
 *
 * @param row - The session row.
 * @param usage - Its last turn's usage, or undefined when it has none.
 * @param settings - Threshold and idle minutes.
 * @param now - The clock (ms).
 */
export function decide(
  row: SessionRow,
  usage: LastTurnUsage | undefined,
  settings: RefreshSettings,
  now: number,
): Decision {
  const { busy, ownershipUnknown } = busyOf(row);
  if (busy) return skip('busy', busy, ownershipUnknown);
  const last = lastActivityOf(row, usage);
  if (last === undefined)
    return skip('no activity time', 'no activity time', ownershipUnknown);
  const idleMs = now - last;
  const idleMin = Math.floor(idleMs / MINUTE_MS);
  if (idleMs < settings.idleMinutes * MINUTE_MS)
    return skip(
      'recently active',
      `recently active (${String(idleMin)} min)`,
      ownershipUnknown,
    );
  if (!usage) return skip('no usage', 'no usage', ownershipUnknown);
  const total = contextOf(usage);
  if (total < settings.contextThreshold)
    return skip('small', `small (${String(total)})`, ownershipUnknown);
  return {
    kind: 'due',
    total,
    idleMin,
    lastActivityMs: last,
    ownershipUnknown,
  };
}
