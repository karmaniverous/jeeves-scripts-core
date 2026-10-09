#!/usr/bin/env tsx
/**
 * @module drain
 *
 * Jira webhook drain — receives Jira webhook payloads from the
 * jeeves-server Event Gateway via stdin, routes by `webhookEvent`, and
 * persists entity snapshots with reverse-diff history.
 *
 * Invoked by jeeves-server's Event Gateway, not by jeeves-runner.
 * See README.md for gateway config and webhook setup instructions.
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

import { nowIso, runScript } from '@karmaniverous/jeeves';

import { getBasePathForJira } from '../config/index.js';
import { constants } from '../lib/constants.js';
import {
  deleteEntity,
  readStdinJson,
  upsertEntity,
  writeUnmatched,
} from '../lib/entity-store.js';

const DOMAIN_DIR = path.join(getBasePathForJira(), 'jira');

// ---------------------------------------------------------------------------
// Custom field translation helpers
// ---------------------------------------------------------------------------

type FieldMap = Record<string, string>;

function loadFieldMap(): FieldMap {
  const fieldsPath = path.join(DOMAIN_DIR, constants().JIRA_FIELDS_FILENAME);
  if (!fs.existsSync(fieldsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(fieldsPath, 'utf8')) as FieldMap;
  } catch {
    return {};
  }
}

/**
 * Add human-readable aliases for every `customfield_*` key present in
 * `fields`. The alias key is the mapped name from _fields.json; the
 * original key is preserved.
 */
function translateCustomFields(
  fields: Record<string, unknown>,
  fieldMap: FieldMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  for (const [k, v] of Object.entries(fields)) {
    if (k.startsWith('customfield_') && fieldMap[k]) {
      out[fieldMap[k]] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type DrainResult =
  | {
      event: string;
      action: 'upsert';
      type: string;
      key: string | number;
      path: string;
    }
  | {
      event: string;
      action: 'delete';
      type: string;
      key: string | number;
      deleted: boolean;
    }
  | { event: string; action: 'unmatched' };

// ---------------------------------------------------------------------------
// Generic entity routing helper
// ---------------------------------------------------------------------------

function routeUpsertDelete(
  event: string,
  obj: Record<string, unknown> | undefined,
  entityType: string,
  idKey: 'id' | 'key',
  now: string,
): DrainResult {
  const id = obj?.[idKey] as string | number | undefined;
  if (id === undefined || id === '') {
    console.error(`No ${entityType} ${idKey} in payload`);
    process.exit(1);
  }
  if (event.includes('deleted')) {
    const deleted = deleteEntity(DOMAIN_DIR, entityType, id);
    return { event, action: 'delete', type: entityType, key: id, deleted };
  }
  const p = upsertEntity(
    DOMAIN_DIR,
    entityType,
    id,
    obj as Record<string, unknown>,
    now,
    constants().JIRA_MAX_HISTORY,
  );
  return { event, action: 'upsert', type: entityType, key: id, path: p };
}

// ---------------------------------------------------------------------------
// Main drain
// ---------------------------------------------------------------------------

async function drainMain(): Promise<void> {
  const body = await readStdinJson();

  const event = body.webhookEvent as string | undefined;
  if (!event) {
    console.error('No webhookEvent in payload');
    process.exit(1);
  }

  const now = nowIso();
  const fieldMap = loadFieldMap();
  let result: DrainResult;

  if (event === 'jira:issue_created' || event === 'jira:issue_updated') {
    const issue = body.issue as Record<string, unknown> | undefined;
    const key = issue?.key as string | undefined;
    if (!key) {
      console.error('No issue key');
      process.exit(1);
    }
    // Translate custom fields in the `fields` sub-object
    const rawFields = issue?.fields as Record<string, unknown> | undefined;
    const current: Record<string, unknown> = {
      ...issue,
      fields: rawFields
        ? translateCustomFields(rawFields, fieldMap)
        : rawFields,
    };
    const p = upsertEntity(
      DOMAIN_DIR,
      'issue',
      key,
      current,
      now,
      constants().JIRA_MAX_HISTORY,
    );
    result = { event, action: 'upsert', type: 'issue', key, path: p };
  } else if (event === 'jira:issue_deleted') {
    const issue = body.issue as Record<string, unknown> | undefined;
    const key = issue?.key as string | undefined;
    if (!key) {
      console.error('No issue key');
      process.exit(1);
    }
    const deleted = deleteEntity(DOMAIN_DIR, 'issue', key);
    result = { event, action: 'delete', type: 'issue', key, deleted };
  } else if (event === 'comment_created' || event === 'comment_updated') {
    const comment = body.comment as Record<string, unknown> | undefined;
    const id = comment?.id as string | number | undefined;
    if (id === undefined || id === '') {
      console.error('No comment id');
      process.exit(1);
    }
    const current: Record<string, unknown> = { ...comment };
    const issueKey = (body.issue as Record<string, unknown> | undefined)?.key;
    if (issueKey) current._issueKey = issueKey;
    const p = upsertEntity(
      DOMAIN_DIR,
      'comment',
      id,
      current,
      now,
      constants().JIRA_MAX_HISTORY,
    );
    result = { event, action: 'upsert', type: 'comment', key: id, path: p };
  } else if (event === 'comment_deleted') {
    const comment = body.comment as Record<string, unknown> | undefined;
    const id = comment?.id as string | number | undefined;
    if (id === undefined || id === '') {
      console.error('No comment id');
      process.exit(1);
    }
    const deleted = deleteEntity(DOMAIN_DIR, 'comment', id);
    result = { event, action: 'delete', type: 'comment', key: id, deleted };
  } else if (event.startsWith('jira:version_')) {
    result = routeUpsertDelete(
      event,
      body.version as Record<string, unknown> | undefined,
      'version',
      'id',
      now,
    );
  } else if (event.startsWith('sprint_')) {
    result = routeUpsertDelete(
      event,
      body.sprint as Record<string, unknown> | undefined,
      'sprint',
      'id',
      now,
    );
  } else if (event.startsWith('board_')) {
    result = routeUpsertDelete(
      event,
      body.board as Record<string, unknown> | undefined,
      'board',
      'id',
      now,
    );
  } else {
    writeUnmatched(DOMAIN_DIR, event, body);
    result = { event, action: 'unmatched' };
  }

  console.log(JSON.stringify(result));
}

runScript('jira/drain', () => {
  drainMain().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
