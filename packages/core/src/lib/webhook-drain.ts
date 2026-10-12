/**
 * @module lib/webhook-drain
 *
 * The shared webhook drain (Jira, Linear): one payload, routed by a
 * per-source route table, becomes an entity upsert, an entity delete or an
 * `_unmatched/` file under the source's domain directory. Pure routing
 * plus `lib/entity-store` file I/O; each source formats its own result line.
 */

import { deleteEntity, upsertEntity, writeUnmatched } from './entity-store.js';

/** A webhook payload. */
export type WebhookBody = Record<string, unknown>;

/** How one event is persisted. */
export interface DrainRoute {
  /** Entity type: the subdirectory under the domain directory. */
  entityType: string;
  /** The entity object in the payload. */
  entity: (body: WebhookBody) => Record<string, unknown> | undefined;
  /** The entity's key field. */
  idKey: string;
  /** Error message when the key is missing. */
  missing: string;
  /** Whether the event deletes the entity (default: upsert). */
  remove?: boolean;
  /** The snapshot to store (default: the entity as received). */
  transform?: (
    entity: Record<string, unknown>,
    body: WebhookBody,
  ) => Record<string, unknown>;
}

/** Where and how a drain writes. */
export interface DrainTarget {
  /** The source's domain directory (`{silo}/jira`, `{silo}/linear`). */
  domainDir: string;
  /** History entries kept per entity. */
  maxHistory: number;
  /** ISO timestamp recorded on the entity. */
  now: string;
}

/** What a drain did. */
export type DrainOutcome =
  | {
      kind: 'upsert';
      entityType: string;
      key: string | number;
      path: string;
    }
  | {
      kind: 'delete';
      entityType: string;
      key: string | number;
      deleted: boolean;
    }
  | { kind: 'unmatched' };

const isMissing = (id: unknown): boolean =>
  id === undefined || id === null || id === '';

/**
 * Persist one payload: through `route` when the event has one, else as an
 * `_unmatched/<label>` file.
 *
 * @throws When the routed entity has no key (`route.missing`).
 */
export function applyDrainRoute(
  route: DrainRoute | undefined,
  body: WebhookBody,
  unmatchedLabel: string,
  target: DrainTarget,
): DrainOutcome {
  if (!route) {
    writeUnmatched(target.domainDir, unmatchedLabel, body);
    return { kind: 'unmatched' };
  }
  const entity = route.entity(body);
  const id = entity?.[route.idKey];
  if (isMissing(id) || !entity) throw new Error(route.missing);
  const key = id as string | number;
  const { entityType } = route;
  if (route.remove) {
    const deleted = deleteEntity(target.domainDir, entityType, key);
    return { kind: 'delete', entityType, key, deleted };
  }
  const snapshot = route.transform ? route.transform(entity, body) : entity;
  const path = upsertEntity(
    target.domainDir,
    entityType,
    key,
    snapshot,
    target.now,
    target.maxHistory,
  );
  return { kind: 'upsert', entityType, key, path };
}

/** An object field of a payload, if it is one. */
export const objectField =
  (field: string) =>
  (body: WebhookBody): Record<string, unknown> | undefined => {
    const value = body[field];
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  };
