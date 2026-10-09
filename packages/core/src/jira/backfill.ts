#!/usr/bin/env tsx
/**
 * @module backfill
 *
 * One-time Jira backfill — populates the issue (and optionally other entity
 * type) archive from the full Jira project backlog via the REST API.
 *
 * Run manually when setting up a new instance or after a data loss event.
 * Existing entity files are skipped (webhook data is fresher). Dry-run
 * mode is the default; pass `--live` for actual writes.
 *
 * Usage:
 *   tsx src/jira/backfill.ts --project WEB [--type issue] [--live]
 *
 * CLI arguments:
 *   --project <key>  Jira project key, e.g. WEB (required)
 *   --type <type>    Entity type to backfill (default: issue)
 *   --live           Perform actual writes (default: dry-run)
 */

import path from 'node:path';

import { getArg, nowIso, runScript } from '@karmaniverous/jeeves';

import { getBasePathForJira } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { backfillEntity } from '../lib/entity-store.js';
import {
  makeAuthHeader,
  readApiToken,
  searchIssues,
} from './lib/jira-client.js';

const DOMAIN_DIR = path.join(getBasePathForJira(), 'jira');
const RATE_LIMIT_MS = 200;

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backfillIssues(
  projectKey: string,
  authHeader: string,
  now: string,
  live: boolean,
): Promise<{ created: number; skipped: number; failed: number }> {
  const jql = `project = ${projectKey} ORDER BY created ASC`;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for await (const issue of searchIssues(
    constants().JIRA_SITE_URL,
    authHeader,
    jql,
    '*all',
    undefined,
    50,
  )) {
    try {
      const current: Record<string, unknown> = {
        id: issue.id,
        key: issue.key,
        fields: issue.fields,
      };

      if (live) {
        const written = backfillEntity(
          DOMAIN_DIR,
          'issue',
          issue.key,
          current,
          now,
        );
        if (written) {
          created++;
          console.log(`[backfill] created ${issue.key}`);
        } else {
          skipped++;
          console.log(`[backfill] skip   ${issue.key} (exists)`);
        }
      } else {
        console.log(`[backfill] dry-run ${issue.key}`);
        skipped++;
      }
    } catch (e) {
      failed++;
      console.error(
        `[backfill] error ${issue.key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await sleepMs(RATE_LIMIT_MS);
  }

  return { created, skipped, failed };
}

async function backfillMain(): Promise<void> {
  if (
    !constants().JIRA_SITE_URL ||
    !constants().JIRA_EMAIL ||
    !constants().JIRA_API_TOKEN_PATH
  ) {
    console.log('[skip] Jira API credentials not configured');
    return;
  }

  const argv = process.argv.slice(2);
  const project = getArg(argv, '--project', '');
  const entityType = getArg(argv, '--type', 'issue');
  const live = hasFlag(argv, '--live');

  if (!project) {
    console.error('[error] --project <key> is required');
    process.exit(1);
  }

  if (entityType !== 'issue') {
    console.error(
      `[error] --type "${entityType}" is not yet supported (only "issue")`,
    );
    process.exit(1);
  }

  console.log(
    `[backfill] project=${project} type=${entityType} live=${String(live)}`,
  );
  if (!live)
    console.log('[backfill] DRY-RUN mode — pass --live for actual writes');

  const apiToken = readApiToken(constants().JIRA_API_TOKEN_PATH);
  const authHeader = makeAuthHeader(constants().JIRA_EMAIL, apiToken);
  const now = nowIso();

  const { created, skipped, failed } = await backfillIssues(
    project,
    authHeader,
    now,
    live,
  );

  console.log(
    `[backfill] done — created=${String(created)} skipped=${String(skipped)} failed=${String(failed)}`,
  );

  if (failed > 0) process.exit(1);
}

runScript('jira/backfill', () => {
  backfillMain().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
