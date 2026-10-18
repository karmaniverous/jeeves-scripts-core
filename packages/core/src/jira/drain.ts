/**
 * @module jira/drain
 *
 * Jira webhook drain: reads one Jira webhook payload from stdin (piped by
 * jeeves-server's event gateway), routes it by `webhookEvent` through a
 * route table and persists the entity snapshot with reverse-diff history
 * under `{silo}/jira` (`lib/webhook-drain`). Prints one JSON result line.
 *
 * Invoked by jeeves-server's event gateway, not by jeeves-runner
 * (`guides/jira.md`).
 *
 * Supported events:
 *   jira:issue_created, jira:issue_updated, jira:issue_deleted
 *   comment_created, comment_updated, comment_deleted
 *   jira:version_created, jira:version_updated, jira:version_deleted
 *   sprint_created, sprint_updated, sprint_deleted
 *   board_created, board_updated, board_deleted
 *
 * Unrecognised events are written to `{domainDir}/_unmatched/`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { nowIso } from '@karmaniverous/jeeves';

import { getBasePathForJira, integrations } from '../config/index.js';
import { defineJob } from '../jobs/define-job.js';
import { readStdinJson } from '../lib/entity-store.js';
import {
  applyDrainRoute,
  type DrainRoute,
  objectField,
  type WebhookBody,
} from '../lib/webhook-drain.js';

/** Custom field id to display name, from `_fields.json`. */
type FieldMap = Record<string, string>;

/** Read the custom field map (`{}` when absent or unreadable). */
export function loadFieldMap(domainDir: string, filename: string): FieldMap {
  const fieldsPath = path.join(domainDir, filename);
  if (!fs.existsSync(fieldsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(fieldsPath, 'utf8')) as FieldMap;
  } catch {
    return {};
  }
}

/**
 * Add a human-readable alias for every mapped `customfield_*` key in
 * `fields`; the original key is kept.
 */
export function translateCustomFields(
  fields: Record<string, unknown>,
  fieldMap: FieldMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  for (const [k, v] of Object.entries(fields)) {
    const alias = fieldMap[k];
    if (k.startsWith('customfield_') && alias) out[alias] = v;
  }
  return out;
}

const issue = objectField('issue');
const comment = objectField('comment');

/** The route for a Jira event, or `undefined` when it is unmatched. */
export function jiraRoute(
  event: string,
  fieldMap: FieldMap,
): DrainRoute | undefined {
  if (event === 'jira:issue_created' || event === 'jira:issue_updated')
    return {
      entityType: 'issue',
      entity: issue,
      idKey: 'key',
      missing: 'No issue key',
      transform: (entity) => {
        const fields = objectField('fields')(entity);
        return {
          ...entity,
          fields: fields ? translateCustomFields(fields, fieldMap) : fields,
        };
      },
    };
  if (event === 'jira:issue_deleted')
    return {
      entityType: 'issue',
      entity: issue,
      idKey: 'key',
      missing: 'No issue key',
      remove: true,
    };
  if (event === 'comment_created' || event === 'comment_updated')
    return {
      entityType: 'comment',
      entity: comment,
      idKey: 'id',
      missing: 'No comment id',
      transform: (entity, body) => {
        const issueKey = issue(body)?.key;
        return issueKey ? { ...entity, _issueKey: issueKey } : { ...entity };
      },
    };
  if (event === 'comment_deleted')
    return {
      entityType: 'comment',
      entity: comment,
      idKey: 'id',
      missing: 'No comment id',
      remove: true,
    };
  const generic = (
    [
      ['jira:version_', 'version'],
      ['sprint_', 'sprint'],
      ['board_', 'board'],
    ] as const
  ).find(([prefix]) => event.startsWith(prefix));
  if (!generic) return undefined;
  const [, entityType] = generic;
  return {
    entityType,
    entity: objectField(entityType),
    idKey: 'id',
    missing: `No ${entityType} id in payload`,
    remove: event.includes('deleted'),
  };
}

/** What {@link jiraDrain} reads and writes. */
export interface JiraDrainDeps {
  /** The `{silo}/jira` directory. */
  domainDir: string;
  /** `_fields.json` file name. */
  fieldsFilename: string;
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
 * Drain one Jira payload and print its result line.
 *
 * @throws When the payload has no `webhookEvent` or the routed entity has no key.
 */
export async function jiraDrain(deps: JiraDrainDeps): Promise<void> {
  const body = await deps.readBody();
  const event = body.webhookEvent;
  if (typeof event !== 'string' || !event)
    throw new Error('No webhookEvent in payload');
  const route = jiraRoute(
    event,
    loadFieldMap(deps.domainDir, deps.fieldsFilename),
  );
  const outcome = applyDrainRoute(route, body, event, {
    domainDir: deps.domainDir,
    maxHistory: deps.maxHistory,
    now: deps.now(),
  });
  const result =
    outcome.kind === 'unmatched'
      ? { event, action: 'unmatched' }
      : outcome.kind === 'upsert'
        ? {
            event,
            action: 'upsert',
            type: outcome.entityType,
            key: outcome.key,
            path: outcome.path,
          }
        : {
            event,
            action: 'delete',
            type: outcome.entityType,
            key: outcome.key,
            deleted: outcome.deleted,
          };
  deps.log(JSON.stringify(result));
}

/** The live dependencies, resolved from config when the drain runs. */
export const jiraDrainDeps = (): JiraDrainDeps => {
  const jira = integrations().jira;
  return {
    domainDir: path.join(getBasePathForJira(), 'jira'),
    fieldsFilename: jira.fieldsFilename,
    maxHistory: jira.maxHistory,
    readBody: readStdinJson,
    now: nowIso,
    log: (line) => {
      console.log(line);
    },
  };
};

export default defineJob({
  id: 'jira-drain',
  domain: 'jira',
  flags: {},
  description:
    "Persist one Jira webhook payload read from stdin (run by jeeves-server's webhook route).",
  name: 'jira/drain',
  run: () => jiraDrain(jiraDrainDeps()),
});
