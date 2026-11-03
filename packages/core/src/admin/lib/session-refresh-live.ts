/**
 * @module admin/lib/session-refresh-live
 *
 * The live collaborators of `admin-refresh-sessions` (spec 2.12): the
 * settings from the job's delta (`jobs."admin-refresh-sessions"`), the
 * gateway calls through `gatewayRpc`, the agent DBs opened read-only once
 * per agent per run (`{openclawStateDir}/agents/<agentId>/agent/openclaw-agent.sqlite`,
 * `agentDbPath`), the Slack client for a gateway account (its bot token
 * from OpenClaw's config) and the doctor check.
 */

import fs from 'node:fs';

import { getErrorMessage } from '@karmaniverous/jeeves';

import { loadConfig } from '../../config/loader.js';
import { agentDbPath } from '../../lib/constants.js';
import { type GatewayRpc, gatewayRpc } from '../../lib/gateway-rpc.js';
import { slackBotToken } from '../../lib/openclaw-config.js';
import { createSlackClient, type SlackClient } from '../../lib/slack-client.js';
import { type AgentDb, openAgentDb } from './openclaw-db/open-agent-db.js';
import type { LastTurnUsage, OpenClawDbSchema } from './openclaw-db/types.js';
import type { RefreshSettings } from './session-refresh-select.js';
import { refreshSettings } from './session-refresh-settings.js';

/** The runnable id; its `jobs.<id>` delta carries the settings. */
export const JOB_ID = 'admin-refresh-sessions';

/** How long the CLI waits for a read (`sessions.list`, `sessions.describe`). */
export const READ_WAIT_MS = 30_000;

/** How long the CLI waits for `sessions.reset` (it drains the session's work first). */
export const RESET_WAIT_MS = 60_000;

/** The gateway RPC caller, with the wait each method needs. */
export const liveRpc: GatewayRpc = (method, params) =>
  gatewayRpc(method, params, undefined, {
    waitMs: method === 'sessions.reset' ? RESET_WAIT_MS : READ_WAIT_MS,
  });

/**
 * The settings from the loaded instance config.
 *
 * @throws When no config loads, or a retired environment variable is set.
 */
export const liveSettings = (): RefreshSettings =>
  refreshSettings(loadConfig().jobs[JOB_ID], process.env);

/** Last-turn usage across agents, each agent's DB opened once. */
export interface UsageReader {
  /** A session's last-turn usage (opens its agent's DB on first use). */
  usage: (agentId: string, sessionId: string) => LastTurnUsage | undefined;
  /** Close every DB opened. */
  close: () => void;
}

type Reader = NonNullable<OpenClawDbSchema['lastTurnUsage']>;

/**
 * Open agent DBs on demand, read-only.
 *
 * @param dbPathFor - An agent's DB path (live: `agentDbPath`).
 * @param exists - Whether a path exists.
 */
export function openUsageReader(
  dbPathFor: (agentId: string) => string = agentDbPath,
  exists: (p: string) => boolean = fs.existsSync,
): UsageReader {
  const open = new Map<string, { db: AgentDb; read: Reader }>();
  const dbFor = (agentId: string) => {
    const cached = open.get(agentId);
    if (cached) return cached;
    const dbPath = dbPathFor(agentId);
    if (!exists(dbPath))
      throw new Error(
        `OpenClaw agent DB for agent ${agentId} not found at ${dbPath}: admin-refresh-sessions needs OpenClaw 2026.9 or later`,
      );
    const db = openAgentDb(dbPath);
    const read = db.schema.lastTurnUsage;
    if (!read) {
      db.close();
      throw new Error(
        `OpenClaw agent DB schema ${String(db.schema.version)} at ${dbPath} has no last-turn usage reader`,
      );
    }
    const entry = { db, read };
    open.set(agentId, entry);
    return entry;
  };
  return {
    usage: (agentId, sessionId) => {
      const { db, read } = dbFor(agentId);
      return read(db.db, db.ctx, sessionId);
    },
    close: () => {
      for (const { db } of open.values()) db.close();
      open.clear();
    },
  };
}

/** A Slack client for a gateway Slack account (its bot token). */
export const liveSlack = (accountId: string): SlackClient =>
  createSlackClient({ token: slackBotToken(accountId) });

/**
 * The doctor check: the main agent's DB opens with a supported schema and
 * the gateway answers `sessions.list`.
 *
 * @returns `true`, or why a run would fail now.
 */
export async function sessionRefreshDoctorCheck(
  rpc: GatewayRpc = liveRpc,
  reader: () => UsageReader = openUsageReader,
): Promise<true | string> {
  try {
    const r = reader();
    try {
      r.usage('main', '');
    } finally {
      r.close();
    }
  } catch (err) {
    return `agent DB: ${getErrorMessage(err)}`;
  }
  try {
    await rpc('sessions.list', { limit: 1 });
  } catch (err) {
    return `gateway: ${getErrorMessage(err)}`;
  }
  return true;
}
