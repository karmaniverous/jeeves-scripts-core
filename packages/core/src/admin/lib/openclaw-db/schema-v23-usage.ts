/**
 * @module openclaw-db/schema-v23-usage
 *
 * Schema 23's `lastTurnUsage` (session refresh, spec 2.12): the newest
 * assistant turn with usage in a session's live transcript. Hot
 * `transcript_events` rows are read newest first (seq descending) and the
 * read stops at the first assistant message whose usage parses
 * (`parseUsageLine`) and is not all zero: OpenClaw writes transcript-only
 * assistant copies (`provider: openclaw`, `model: delivery-mirror`) with
 * all-zero usage and a zero `cost` object, and those say nothing about the
 * context, so they are skipped. The session's cold archive is read only when the hot
 * rows hold none (OpenClaw's cold storage moves a whole inactive transcript
 * out of the hot table, so hot rows, when present, are the newest).
 *
 * A `reset` event ends the read: OpenClaw 2026.9.6 resets a session in
 * place, keeping its session id and appending `{ "type": "reset" }` to the
 * same transcript, so every turn before it belongs to a context that no
 * longer exists. A session reset since its last turn therefore has no
 * last-turn usage, and session refresh does not reset it again.
 * Read-only.
 */

import type { DatabaseSync } from 'node:sqlite';

import { parseUsageLine } from '../usage-parser.js';
import {
  COLD_ROW_COLUMNS,
  type ColdRow,
  decodeEventRow,
  readColdEvents,
} from './schema-v23-payloads.js';
import type { LastTurnUsage, SchemaContext } from './types.js';

type HotRow = Parameters<typeof decodeEventRow>[0];

const count = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : 0;

/**
 * The usage of one transcript event, when it is an assistant turn with
 * non-zero usage (an all-zero copy, e.g. a delivery mirror, has none).
 */
export function assistantUsage(json: string): LastTurnUsage | undefined {
  const parsed = parseUsageLine(json);
  if (!parsed) return undefined;
  const role = (JSON.parse(json) as { message?: { role?: unknown } }).message
    ?.role;
  if (role !== 'assistant') return undefined;
  const { rawUsage, tsMs } = parsed;
  const usage = {
    input: count(rawUsage.input),
    cacheRead: count(rawUsage.cacheRead),
    cacheWrite: count(rawUsage.cacheWrite),
    tsMs,
  };
  const tokens =
    usage.input +
    usage.cacheRead +
    usage.cacheWrite +
    count(rawUsage.output) +
    count(rawUsage.totalTokens);
  return tokens > 0 ? usage : undefined;
}

/** Whether a transcript event is OpenClaw's in-place reset marker. */
export function isResetEvent(json: string): boolean {
  try {
    return (JSON.parse(json) as { type?: unknown }).type === 'reset';
  } catch {
    return false;
  }
}

/** Why {@link firstUsage} stopped. */
type Scan =
  | { kind: 'usage'; usage: LastTurnUsage }
  | { kind: 'reset' }
  | { kind: 'none' };

/**
 * The newest assistant usage among events given newest first, stopping at
 * a reset marker (nothing before it is the current context).
 */
function firstUsage(jsons: Iterable<string>): Scan {
  for (const json of jsons) {
    if (isResetEvent(json)) return { kind: 'reset' };
    const usage = assistantUsage(json);
    if (usage) return { kind: 'usage', usage };
  }
  return { kind: 'none' };
}

function* hotNewestFirst(
  db: DatabaseSync,
  sessionId: string,
): Generator<string> {
  const rows = db
    .prepare(
      'SELECT event_json, event_zstd, event_utf8_bytes FROM transcript_events WHERE session_id = ? ORDER BY seq DESC',
    )
    .iterate(sessionId) as Iterable<HotRow>;
  for (const row of rows) yield decodeEventRow(row);
}

function* coldNewestFirst(
  db: DatabaseSync,
  ctx: SchemaContext,
  sessionId: string,
): Generator<string> {
  const row = db
    .prepare(
      `SELECT ${COLD_ROW_COLUMNS} FROM session_transcript_cold_archives WHERE session_id = ?`,
    )
    .get(sessionId) as ColdRow | undefined;
  if (!row) return;
  const events = readColdEvents(row, ctx);
  for (let i = events.length - 1; i >= 0; i--) yield events[i]!.json;
}

/**
 * The newest assistant turn with usage in a session's live transcript.
 *
 * @param db - The open agent DB.
 * @param ctx - Its artifact paths (cold archives).
 * @param sessionId - The session id.
 * @returns The turn's usage, or `undefined` when the session has none.
 * @throws When a payload fails to decode or a cold archive fails verification.
 */
export function lastTurnUsageV23(
  db: DatabaseSync,
  ctx: SchemaContext,
  sessionId: string,
): LastTurnUsage | undefined {
  const hot = firstUsage(hotNewestFirst(db, sessionId));
  if (hot.kind === 'usage') return hot.usage;
  // A reset in the hot rows ends the context: the cold archive is older.
  if (hot.kind === 'reset') return undefined;
  const cold = firstUsage(coldNewestFirst(db, ctx, sessionId));
  return cold.kind === 'usage' ? cold.usage : undefined;
}
