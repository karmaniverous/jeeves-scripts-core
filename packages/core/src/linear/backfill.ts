#!/usr/bin/env tsx
/**
 * @module backfill
 *
 * One-time Linear backfill — populates the issue (or comment) archive
 * from the Linear GraphQL API via cursor pagination.
 *
 * Run manually when setting up a new instance or after a data loss event.
 * Existing entity files are skipped (webhook/sync data is fresher). Dry-run
 * mode is the default; pass `--live` for actual writes.
 *
 * Usage:
 *   jeeves-scripts run <job-id> --team CRE [--type issue] [--live]
 *   (a manifest entry in the instance's jobs/*.json with script src/linear/backfill.ts)
 *
 * CLI arguments:
 *   --team KEY   Linear team key, e.g. CRE (required for type=issue)
 *   --type TYPE  Entity type to backfill: issue | comment (default: issue)
 *   --live       Perform actual writes (default: dry-run)
 */

import path from 'node:path';

import { getArg, nowIso, runScript } from '@karmaniverous/jeeves';

import { getBasePathForLinear } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { backfillEntity } from '../lib/entity-store.js';
import {
  enrichComment,
  loadConfig,
  paginateComments,
  paginateIssues,
  sleepMs,
} from './lib/linear-client.js';

const DOMAIN_DIR = path.join(getBasePathForLinear(), 'linear');
const RATE_LIMIT_MS = 200;

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// Issue backfill
// ---------------------------------------------------------------------------

async function backfillIssues(
  teamKey: string,
  now: string,
  live: boolean,
): Promise<{ created: number; skipped: number; failed: number }> {
  const config = loadConfig();
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for await (const issue of paginateIssues(config, teamKey)) {
    const identifier = issue.identifier as string | undefined;
    if (!identifier) {
      console.error('[backfill] issue missing identifier, skipping');
      failed++;
      continue;
    }

    try {
      if (live) {
        const written = backfillEntity(
          DOMAIN_DIR,
          'issue',
          identifier,
          issue,
          now,
        );
        if (written) {
          created++;
          console.log(`[backfill] created ${identifier}`);
        } else {
          skipped++;
          console.log(`[backfill] skip   ${identifier} (exists)`);
        }
      } else {
        console.log(`[backfill] dry-run ${identifier}`);
        skipped++;
      }
    } catch (e) {
      failed++;
      console.error(
        `[backfill] error ${identifier}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await sleepMs(RATE_LIMIT_MS);
  }

  return { created, skipped, failed };
}

// ---------------------------------------------------------------------------
// Comment backfill
// ---------------------------------------------------------------------------

async function backfillComments(
  now: string,
  live: boolean,
): Promise<{ created: number; skipped: number; failed: number }> {
  const config = loadConfig();
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for await (const comment of paginateComments(config)) {
    const id = comment.id as string | undefined;
    if (!id) {
      console.error('[backfill] comment missing id, skipping');
      failed++;
      continue;
    }

    try {
      const current = enrichComment(comment);

      if (live) {
        const written = backfillEntity(DOMAIN_DIR, 'comment', id, current, now);
        if (written) {
          created++;
          console.log(`[backfill] created comment/${id}`);
        } else {
          skipped++;
          console.log(`[backfill] skip   comment/${id} (exists)`);
        }
      } else {
        console.log(`[backfill] dry-run comment/${id}`);
        skipped++;
      }
    } catch (e) {
      failed++;
      console.error(
        `[backfill] error comment/${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await sleepMs(RATE_LIMIT_MS);
  }

  return { created, skipped, failed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function backfillMain(): Promise<void> {
  try {
    loadConfig();
  } catch {
    console.log(
      `[skip] Linear config not found at ${constants().LINEAR_CONFIG_PATH}`,
    );
    return;
  }

  const argv = process.argv.slice(2);
  const teamKey = getArg(argv, '--team', '');
  const entityType = getArg(argv, '--type', 'issue');
  const live = hasFlag(argv, '--live');

  if (entityType !== 'issue' && entityType !== 'comment') {
    console.error(
      `[error] --type "${entityType}" is not supported (only "issue" or "comment")`,
    );
    process.exit(1);
  }

  if (entityType === 'issue' && !teamKey) {
    console.error('[error] --team <key> is required for --type issue');
    process.exit(1);
  }

  console.log(
    `[backfill] team=${teamKey || '(all)'} type=${entityType} live=${String(live)}`,
  );
  if (!live)
    console.log('[backfill] DRY-RUN mode — pass --live for actual writes');

  const now = nowIso();
  let stats: { created: number; skipped: number; failed: number };

  if (entityType === 'issue') {
    stats = await backfillIssues(teamKey, now, live);
  } else {
    stats = await backfillComments(now, live);
  }

  const { created, skipped, failed } = stats;
  console.log(
    `[backfill] done — created=${String(created)} skipped=${String(skipped)} failed=${String(failed)}`,
  );

  if (failed > 0) process.exit(1);
}

runScript('linear/backfill', () => {
  backfillMain().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
