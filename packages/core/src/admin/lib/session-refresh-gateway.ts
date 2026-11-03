/**
 * @module admin/lib/session-refresh-gateway
 *
 * The gateway calls session refresh makes (spec 2.12), over `gatewayRpc`
 * (`openclaw gateway call`): `sessions.list` (paged until complete),
 * `sessions.describe` and `sessions.reset` fenced with
 * `expectedSessionId`. Each result is parsed with a Zod schema of only
 * the fields the job uses (unknown fields pass through), so a changed
 * shape fails the run instead of reading as "nothing to do". Field
 * presence was pinned against OpenClaw 2026.9.6: list rows carry
 * `hasActiveRun` and (usually) `activeRunIds`; `sessions.describe` may
 * omit both.
 */

import { z } from 'zod';

import { type GatewayRpc, GatewayRpcError } from '../../lib/gateway-rpc.js';
import { isRecord } from '../../lib/is-record.js';

/** Rows asked for per `sessions.list` page (OpenClaw applies at most 200). */
export const LIST_PAGE_SIZE = 200;

/** Most `sessions.list` pages read in one run (guards a list that never ends). */
export const MAX_LIST_PAGES = 500;

/** A Slack (or other channel) delivery target recorded on a session row. */
const targetSchema = z.looseObject({
  channel: z.string().nullish(),
  to: z.string().nullish(),
  accountId: z.string().nullish(),
});

/** One gateway session row: the fields session refresh reads. */
export const sessionRowSchema = z.looseObject({
  /** The session key, e.g. `agent:main:slack:channel:c0123456789`. */
  key: z.string().min(1),
  /** The current session id (the reset fence). */
  sessionId: z.string().min(1),
  /** The owning agent (else parsed from the key). */
  agentId: z.string().min(1).nullish(),
  /** Archived rows are never listed by default; dropped if one appears. */
  archived: z.boolean().nullish(),
  /** Authoritative aggregate activity. */
  hasActiveRun: z.boolean().nullish(),
  /** When present, the complete set of active runs (`[]` proves idle). */
  activeRunIds: z.array(z.string()).nullish(),
  /** Last completed run (ms). */
  lastActivityAt: z.number().nullish(),
  /** Last user or channel input (ms). */
  lastInteractionAt: z.number().nullish(),
  /** Spawn lineage: any of these puts the row out of scope. */
  spawnedBy: z.string().nullish(),
  parentSessionKey: z.string().nullish(),
  spawnDepth: z.number().nullish(),
  /** Cloud or device placement; anything but `local` is busy. */
  placement: z.looseObject({ state: z.string() }).nullish(),
  /** The session's channel (`slack`, ...). */
  channel: z.string().nullish(),
  /** Where the session's messages go. */
  deliveryContext: targetSchema.nullish(),
  /** Where the session came from (`nativeChannelId`: the Slack conversation id). */
  origin: z
    .looseObject({
      provider: z.string().nullish(),
      nativeChannelId: z.string().nullish(),
      accountId: z.string().nullish(),
    })
    .nullish(),
  /** The account of the last delivery. */
  lastAccountId: z.string().nullish(),
});

/** One gateway session row. */
export type SessionRow = z.infer<typeof sessionRowSchema>;

const listPageSchema = z.looseObject({
  sessions: z.array(sessionRowSchema),
  hasMore: z.boolean().nullish(),
  nextOffset: z.number().int().nonnegative().nullish(),
});

const describeSchema = z.looseObject({ session: sessionRowSchema });

const resetSchema = z.looseObject({});

/** How a fenced reset ended. */
export type ResetOutcome = 'reset' | 'changed';

/** The gateway session calls, bound to an RPC caller. */
export interface SessionGateway {
  /** Every unarchived session (all pages, deduplicated by key). */
  list: () => Promise<SessionRow[]>;
  /** One session's current row. */
  describe: (key: string) => Promise<SessionRow>;
  /** Reset a session unless its id has changed since it was read. */
  reset: (key: string, expectedSessionId: string) => Promise<ResetOutcome>;
}

/** Parse a gateway result, failing with the method and the schema's complaint. */
function parse<T>(method: string, schema: z.ZodType<T>, result: unknown): T {
  const parsed = schema.safeParse(result);
  if (!parsed.success)
    throw new Error(
      `gateway ${method} returned an unexpected shape: ${z.prettifyError(parsed.error)}`,
    );
  return parsed.data;
}

/** True for the gateway's `session-changed` rejection of a fenced reset. */
export function isSessionChanged(err: unknown): boolean {
  return (
    err instanceof GatewayRpcError &&
    isRecord(err.details) &&
    err.details.reason === 'session-changed'
  );
}

/**
 * List every session, paging with `offset`/`nextOffset` until `hasMore`
 * is false. Rows are deduplicated by key (pages are a live view).
 *
 * @throws When a call fails, a page fails its schema, or the paging is
 *   inconsistent (more pages but no forward `nextOffset`, or too many).
 */
export async function listSessions(rpc: GatewayRpc): Promise<SessionRow[]> {
  const rows = new Map<string, SessionRow>();
  let offset = 0;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const result = parse(
      'sessions.list',
      listPageSchema,
      await rpc('sessions.list', { limit: LIST_PAGE_SIZE, offset }),
    );
    for (const row of result.sessions)
      if (!rows.has(row.key)) rows.set(row.key, row);
    if (result.hasMore !== true) return [...rows.values()];
    const next = result.nextOffset;
    if (typeof next !== 'number' || next <= offset)
      throw new Error(
        `gateway sessions.list reported more rows without a forward nextOffset (offset ${String(offset)})`,
      );
    offset = next;
  }
  throw new Error(
    `gateway sessions.list did not finish within ${String(MAX_LIST_PAGES)} pages`,
  );
}

/**
 * One session's current row.
 *
 * @throws When the call fails, the row fails its schema or names another key.
 */
export async function describeSession(
  rpc: GatewayRpc,
  key: string,
): Promise<SessionRow> {
  const { session } = parse(
    'sessions.describe',
    describeSchema,
    await rpc('sessions.describe', { key }),
  );
  if (session.key !== key)
    throw new Error(
      `gateway sessions.describe returned ${session.key} for ${key}`,
    );
  return session;
}

/**
 * Reset a session, fenced with the id it was read with.
 *
 * @returns `reset`, or `changed` when the gateway rejected the fence.
 * @throws Any other failure.
 */
export async function resetSession(
  rpc: GatewayRpc,
  key: string,
  expectedSessionId: string,
): Promise<ResetOutcome> {
  try {
    parse(
      'sessions.reset',
      resetSchema,
      await rpc('sessions.reset', { key, expectedSessionId }),
    );
    return 'reset';
  } catch (err) {
    if (isSessionChanged(err)) return 'changed';
    throw err;
  }
}

/** The three calls bound to one RPC caller. */
export const sessionGateway = (rpc: GatewayRpc): SessionGateway => ({
  list: () => listSessions(rpc),
  describe: (key) => describeSession(rpc, key),
  reset: (key, expectedSessionId) => resetSession(rpc, key, expectedSessionId),
});
