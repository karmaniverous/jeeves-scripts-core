/**
 * @module linear/lib/linear-sync
 *
 * The shared Linear entity loop behind `linear-sync-issues`,
 * `linear-sync-comments` and `linear-backfill`: pages through issues or
 * comments, stores each one (upsert with history, or backfill once) under
 * `{silo}/linear`, rate-limits, and tallies the outcome. Also the
 * runnables' collaborators and their live values (read at run time).
 */

import path from 'node:path';

import { nowIso, sleepAsync } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { getBasePathForLinear, integrations } from '../../config/index.js';
import { upsertEntity } from '../../lib/entity-store.js';
import {
  enrichComment,
  type LinearConfig,
  loadConfig,
  paginateComments,
  paginateIssues,
} from './linear-client.js';

/** Delay between entities. */
export const RATE_LIMIT_MS = 200;

/** A Linear entity kind the archive stores. */
export type LinearKind = 'issue' | 'comment';

/** Pages of Linear entities. */
export interface LinearPaginators {
  issue: (
    config: LinearConfig,
    teamKey?: string,
    updatedAfter?: string,
  ) => AsyncIterable<Record<string, unknown>>;
  comment: (
    config: LinearConfig,
    updatedAfter?: string,
  ) => AsyncIterable<Record<string, unknown>>;
}

/** What the Linear runnables read, write and call. */
export interface LinearJobDeps {
  /** The Linear credentials file (`integrations.linear.configPath`). */
  configPath: string;
  /** Reads and validates the credentials file. */
  loadConfig: (file: string) => LinearConfig;
  /** The GraphQL paginators. */
  paginate: LinearPaginators;
  /** The `{silo}/linear` archive directory. */
  domainDir: string;
  /** History entries kept per entity. */
  maxHistory: number;
  /** ISO timestamp. */
  now: () => string;
  /** Rate-limit delay. */
  sleep: (ms: number) => Promise<void>;
  /** Runner state client (cursors). */
  runner: () => Pick<RunnerClient, 'getState' | 'setState' | 'close'>;
}

/** The live collaborators, from config. */
export const linearJobDeps = (): LinearJobDeps => {
  const linear = integrations().linear;
  return {
    configPath: linear.configPath,
    loadConfig,
    paginate: { issue: paginateIssues, comment: paginateComments },
    domainDir: path.join(getBasePathForLinear(), 'linear'),
    maxHistory: linear.maxHistory,
    now: nowIso,
    sleep: sleepAsync,
    runner: () => getRunnerClient(),
  };
};

/**
 * The credentials, or `undefined` after logging the skip line when the
 * file is missing or invalid.
 */
export function linearConfigOrSkip(
  deps: LinearJobDeps,
): LinearConfig | undefined {
  try {
    return deps.loadConfig(deps.configPath);
  } catch {
    console.log(`[skip] Linear config not found at ${deps.configPath}`);
    return undefined;
  }
}

/** How one kind is keyed, labelled and stored. */
const KINDS = {
  issue: {
    idKey: 'identifier',
    label: (id: string) => id,
    snapshot: (e: Record<string, unknown>) => e,
  },
  comment: {
    idKey: 'id',
    label: (id: string) => `comment/${id}`,
    snapshot: enrichComment,
  },
} as const;

/** A loop's outcome. */
export interface LinearTally {
  /** Entities stored. */
  stored: number;
  /** Entities passed over (backfill: existing or dry run). */
  skipped: number;
  /** Entities without a key or whose write failed. */
  failed: number;
  /** The latest `updatedAt` seen, for the sync cursor. */
  latestUpdatedAt: string | null;
}

/**
 * Store every entity from `entities`: `store(key, snapshot)` returns
 * whether it was stored (else skipped). Logs a missing key or a failed
 * write under `prefix` and keeps going.
 */
export async function forEachLinearEntity(
  kind: LinearKind,
  entities: AsyncIterable<Record<string, unknown>>,
  prefix: string,
  store: (
    key: string,
    snapshot: Record<string, unknown>,
    label: string,
  ) => boolean,
  deps: Pick<LinearJobDeps, 'sleep'>,
): Promise<LinearTally> {
  const spec = KINDS[kind];
  const tally: LinearTally = {
    stored: 0,
    skipped: 0,
    failed: 0,
    latestUpdatedAt: null,
  };
  for await (const entity of entities) {
    const id = entity[spec.idKey] as string | undefined;
    if (!id) {
      console.error(`${prefix} ${kind} missing ${spec.idKey}, skipping`);
      tally.failed++;
      continue;
    }
    const label = spec.label(id);
    try {
      if (store(id, spec.snapshot(entity), label)) tally.stored++;
      else tally.skipped++;
      const updatedAt = entity.updatedAt as string | undefined;
      if (
        updatedAt &&
        (!tally.latestUpdatedAt || updatedAt > tally.latestUpdatedAt)
      )
        tally.latestUpdatedAt = updatedAt;
    } catch (e) {
      tally.failed++;
      console.error(
        `${prefix} error ${label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await deps.sleep(RATE_LIMIT_MS);
  }
  return tally;
}

/** Runner state namespace for the sync cursors. */
const STATE_NS = 'linear';

/**
 * The cursor sync (`linear-sync-issues`, `linear-sync-comments`): upserts
 * every entity updated since the stored cursor, then advances the cursor
 * to the latest `updatedAt`. Missing credentials skip; any failed entity
 * sets exit code 1.
 */
export async function syncLinear(
  kind: LinearKind,
  deps: LinearJobDeps,
): Promise<void> {
  const config = linearConfigOrSkip(deps);
  if (!config) return;
  const prefix = `[sync-${kind}s]`;
  const stateKey = `sync-${kind}s-cursor`;
  const client = deps.runner();
  try {
    const cursor = client.getState(STATE_NS, stateKey) ?? undefined;
    console.log(`${prefix} start ${deps.now()} cursor=${cursor ?? '(none)'}`);
    const entities =
      kind === 'issue'
        ? deps.paginate.issue(config, undefined, cursor)
        : deps.paginate.comment(config, cursor);
    const tally = await forEachLinearEntity(
      kind,
      entities,
      prefix,
      (key, snapshot) => {
        upsertEntity(
          deps.domainDir,
          kind,
          key,
          snapshot,
          deps.now(),
          deps.maxHistory,
        );
        return true;
      },
      deps,
    );
    if (tally.latestUpdatedAt) {
      client.setState(STATE_NS, stateKey, tally.latestUpdatedAt);
      console.log(`${prefix} cursor \u2192 ${tally.latestUpdatedAt}`);
    }
    console.log(
      `${prefix} end ${deps.now()} \u2014 upserted=${String(tally.stored)} failed=${String(tally.failed)}`,
    );
    if (tally.failed > 0) process.exitCode = 1;
  } finally {
    client.close();
  }
}
