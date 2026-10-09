#!/usr/bin/env tsx
/**
 * @module drain
 *
 * Linear webhook drain — receives Linear webhook payloads from the
 * jeeves-server Event Gateway via stdin, routes by `action` + `type`,
 * and persists entity snapshots with reverse-diff history.
 *
 * Invoked by jeeves-server's Event Gateway, not by jeeves-runner.
 * See README.md for gateway config and webhook setup instructions.
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

import { nowIso, runScript } from '@karmaniverous/jeeves';

import { getBasePathForLinear } from '../config/index.js';
import { constants } from '../lib/constants.js';
import {
  deleteEntity,
  readStdinJson,
  upsertEntity,
  writeUnmatched,
} from '../lib/entity-store.js';
import { enrichComment } from './lib/linear-client.js';

const DOMAIN_DIR = path.join(getBasePathForLinear(), 'linear');

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type DrainResult =
  | {
      action: string;
      type: string;
      entityAction: 'upsert';
      entityType: string;
      key: string | number;
      path: string;
    }
  | {
      action: string;
      type: string;
      entityAction: 'delete';
      entityType: string;
      key: string | number;
      deleted: boolean;
    }
  | { action: string; type: string; entityAction: 'unmatched' };

// ---------------------------------------------------------------------------
// Main drain
// ---------------------------------------------------------------------------

async function drainMain(): Promise<void> {
  const body = await readStdinJson();

  const action = body.action as string | undefined;
  const type = body.type as string | undefined;
  const data = body.data as Record<string, unknown> | undefined;

  if (!action || !type) {
    console.error('Missing action or type in payload');
    process.exit(1);
  }

  const now = nowIso();
  const isRemove = action === 'remove';
  let result: DrainResult;

  if (type === 'Issue') {
    const identifier = data?.identifier as string | undefined;
    if (!identifier) {
      console.error('No issue identifier in payload');
      process.exit(1);
    }
    if (isRemove) {
      const deleted = deleteEntity(DOMAIN_DIR, 'issue', identifier);
      result = {
        action,
        type,
        entityAction: 'delete',
        entityType: 'issue',
        key: identifier,
        deleted,
      };
    } else {
      const current: Record<string, unknown> = { ...data };
      const p = upsertEntity(
        DOMAIN_DIR,
        'issue',
        identifier,
        current,
        now,
        constants().LINEAR_MAX_HISTORY,
      );
      result = {
        action,
        type,
        entityAction: 'upsert',
        entityType: 'issue',
        key: identifier,
        path: p,
      };
    }
  } else if (type === 'Comment') {
    const id = data?.id as string | undefined;
    if (!id) {
      console.error('No comment id in payload');
      process.exit(1);
    }
    if (isRemove) {
      const deleted = deleteEntity(DOMAIN_DIR, 'comment', id);
      result = {
        action,
        type,
        entityAction: 'delete',
        entityType: 'comment',
        key: id,
        deleted,
      };
    } else {
      const current = enrichComment(data!);
      const p = upsertEntity(
        DOMAIN_DIR,
        'comment',
        id,
        current,
        now,
        constants().LINEAR_MAX_HISTORY,
      );
      result = {
        action,
        type,
        entityAction: 'upsert',
        entityType: 'comment',
        key: id,
        path: p,
      };
    }
  } else if (type === 'Cycle') {
    const number = data?.number as string | number | undefined;
    if (number === undefined || number === '') {
      console.error('No cycle number in payload');
      process.exit(1);
    }
    const p = upsertEntity(
      DOMAIN_DIR,
      'cycle',
      number,
      data!,
      now,
      constants().LINEAR_MAX_HISTORY,
    );
    result = {
      action,
      type,
      entityAction: 'upsert',
      entityType: 'cycle',
      key: number,
      path: p,
    };
  } else if (type === 'Project') {
    const id = data?.id as string | undefined;
    if (!id) {
      console.error('No project id in payload');
      process.exit(1);
    }
    const p = upsertEntity(
      DOMAIN_DIR,
      'project',
      id,
      data!,
      now,
      constants().LINEAR_MAX_HISTORY,
    );
    result = {
      action,
      type,
      entityAction: 'upsert',
      entityType: 'project',
      key: id,
      path: p,
    };
  } else if (type === 'IssueLabel') {
    const id = data?.id as string | undefined;
    if (!id) {
      console.error('No label id in payload');
      process.exit(1);
    }
    const p = upsertEntity(
      DOMAIN_DIR,
      'label',
      id,
      data!,
      now,
      constants().LINEAR_MAX_HISTORY,
    );
    result = {
      action,
      type,
      entityAction: 'upsert',
      entityType: 'label',
      key: id,
      path: p,
    };
  } else {
    const label = `${action}-${type}`;
    writeUnmatched(DOMAIN_DIR, label, body);
    result = { action, type, entityAction: 'unmatched' };
  }

  console.log(JSON.stringify(result));
}

runScript('linear/drain', () => {
  drainMain().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
