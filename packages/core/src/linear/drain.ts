/**
 * @module linear/drain
 *
 * Linear webhook drain: reads one Linear webhook payload from stdin (piped
 * by jeeves-server's event gateway), routes it by `type` and `action`
 * through a route table and persists the entity snapshot with reverse-diff
 * history under `{silo}/linear` (`lib/webhook-drain`). Prints one JSON
 * result line.
 *
 * Invoked by jeeves-server's event gateway, not by jeeves-runner
 * (`guides/linear.md`).
 *
 * Supported webhook types:
 *   Issue create/update/remove
 *   Comment create/update/remove
 *   Cycle create/update
 *   Project create/update
 *   IssueLabel create/update
 *
 * Unrecognised events are written to `{domainDir}/_unmatched/`.
 */

import path from 'node:path';

import { nowIso } from '@karmaniverous/jeeves';

import { getBasePathForLinear, integrations } from '../config/index.js';
import { defineJob } from '../jobs/define-job.js';
import { readStdinJson } from '../lib/entity-store.js';
import {
  applyDrainRoute,
  type DrainRoute,
  objectField,
  type WebhookBody,
} from '../lib/webhook-drain.js';
import { enrichComment } from './lib/linear-client.js';

const data = objectField('data');

/**
 * The route for a Linear event, or `undefined` when it is unmatched. Only
 * issues and comments are deleted on `remove`; the other types are upserted
 * whatever the action.
 */
export function linearRoute(
  type: string,
  action: string,
): DrainRoute | undefined {
  const remove = action === 'remove';
  switch (type) {
    case 'Issue':
      return {
        entityType: 'issue',
        entity: data,
        idKey: 'identifier',
        missing: 'No issue identifier in payload',
        remove,
        transform: (entity) => ({ ...entity }),
      };
    case 'Comment':
      return {
        entityType: 'comment',
        entity: data,
        idKey: 'id',
        missing: 'No comment id in payload',
        remove,
        transform: (entity) => enrichComment(entity),
      };
    case 'Cycle':
      return {
        entityType: 'cycle',
        entity: data,
        idKey: 'number',
        missing: 'No cycle number in payload',
      };
    case 'Project':
      return {
        entityType: 'project',
        entity: data,
        idKey: 'id',
        missing: 'No project id in payload',
      };
    case 'IssueLabel':
      return {
        entityType: 'label',
        entity: data,
        idKey: 'id',
        missing: 'No label id in payload',
      };
    default:
      return undefined;
  }
}

/** What {@link linearDrain} reads and writes. */
export interface LinearDrainDeps {
  /** The `{silo}/linear` directory. */
  domainDir: string;
  /** History entries kept per entity. */
  maxHistory: number;
  /** The payload (default: stdin). */
  readBody: () => Promise<WebhookBody>;
  /** ISO timestamp. */
  now: () => string;
  /** Result line writer. */
  log: (line: string) => void;
}

/**
 * Drain one Linear payload and print its result line.
 *
 * @throws When the payload has no `action` or `type`, or the routed entity has no key.
 */
export async function linearDrain(deps: LinearDrainDeps): Promise<void> {
  const body = await deps.readBody();
  const { action, type } = body;
  if (
    typeof action !== 'string' ||
    !action ||
    typeof type !== 'string' ||
    !type
  )
    throw new Error('Missing action or type in payload');
  const outcome = applyDrainRoute(
    linearRoute(type, action),
    body,
    `${action}-${type}`,
    { domainDir: deps.domainDir, maxHistory: deps.maxHistory, now: deps.now() },
  );
  const result =
    outcome.kind === 'unmatched'
      ? { action, type, entityAction: 'unmatched' }
      : outcome.kind === 'upsert'
        ? {
            action,
            type,
            entityAction: 'upsert',
            entityType: outcome.entityType,
            key: outcome.key,
            path: outcome.path,
          }
        : {
            action,
            type,
            entityAction: 'delete',
            entityType: outcome.entityType,
            key: outcome.key,
            deleted: outcome.deleted,
          };
  deps.log(JSON.stringify(result));
}

/** The live dependencies, resolved from config when the drain runs. */
export const linearDrainDeps = (): LinearDrainDeps => ({
  domainDir: path.join(getBasePathForLinear(), 'linear'),
  maxHistory: integrations().linear.maxHistory,
  readBody: readStdinJson,
  now: nowIso,
  log: (line) => {
    console.log(line);
  },
});

export default defineJob({
  id: 'linear-drain',
  domain: 'linear',
  flags: {},
  description:
    "Persist one Linear webhook payload read from stdin (run by jeeves-server's webhook route).",
  name: 'linear/drain',
  run: () => linearDrain(linearDrainDeps()),
});
