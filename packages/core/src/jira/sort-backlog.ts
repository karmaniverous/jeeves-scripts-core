#!/usr/bin/env tsx
/**
 * @module sort-backlog
 *
 * Stable-sort the Jira backlog by priority group.
 *
 * Issues retain their existing relative order within each priority group,
 * but the groups are collected: no-priority on top, then Highest → Lowest.
 *
 * Usage:
 *   tsx src/jira/sort-backlog.ts          # dry-run (default)
 *   tsx src/jira/sort-backlog.ts --live   # actually re-rank
 *
 * Designed to run ad-hoc and as a daily runner job.
 */

import { integrations } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { agilePut, fetchBacklog } from './lib/agile-api.js';
import {
  printChangeSummary,
  printPriorityDistribution,
  printTopPreview,
} from './lib/backlog-report.js';
import {
  planRerank,
  RANK_BATCH_SIZE,
  stableSortByPriority,
} from './lib/backlog-sort.js';
import { makeAuthHeader, readApiToken } from './lib/jira-client.js';

// `integrations.jira.boardId` in jeeves-scripts.json, else JIRA_BOARD_ID.
const BOARD_ID = integrations().jira.boardId ?? NaN;
if (!BOARD_ID || isNaN(BOARD_ID)) {
  console.error(
    'Error: set integrations.jira.boardId in jeeves-scripts.json (or the JIRA_BOARD_ID environment variable) to your Jira board ID.',
  );
  process.exit(1);
}

/** Execute (live) or log (dry-run) the planned rank calls; returns call count. */
async function rerank(
  authHeader: string,
  sortedKeys: string[],
  currentFirstKey: string,
  live: boolean,
): Promise<number> {
  const ops = planRerank(sortedKeys, currentFirstKey);
  for (const op of ops) {
    if (live) {
      await agilePut(authHeader, 'issue/rank', op.body);
    } else {
      console.log(op.dryRunMessage);
    }
  }
  return ops.length;
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const mode = live ? 'LIVE' : 'DRY-RUN';

  console.log(`\n=== Jira Backlog Priority Sort (${mode}) ===\n`);

  // Guard: skip cleanly if credentials are not configured
  if (
    !constants().JIRA_SITE_URL ||
    !constants().JIRA_EMAIL ||
    !constants().JIRA_API_TOKEN_PATH
  ) {
    console.log('[skip] Jira API credentials not configured');
    return;
  }

  const apiToken = readApiToken(constants().JIRA_API_TOKEN_PATH);
  const authHeader = makeAuthHeader(constants().JIRA_EMAIL, apiToken);

  // 1. Fetch backlog
  console.log(`Fetching backlog from board ${String(BOARD_ID)}...`);
  const backlog = await fetchBacklog(authHeader, BOARD_ID);
  console.log(`  ${String(backlog.length)} issues in backlog\n`);

  if (backlog.length <= 1) {
    console.log('Nothing to sort.');
    return;
  }

  console.log(`  (${String(backlog.length)} total, filtering epics next)`);

  // 2. Filter out epics
  const epics = backlog.filter((i) => i.fields.issuetype?.name === 'Epic');
  const issues = backlog.filter((i) => i.fields.issuetype?.name !== 'Epic');
  if (epics.length > 0) {
    console.log(
      `  Skipping ${String(epics.length)} epic(s) — not included in sort\n`,
    );
  }

  // 3. Count by priority
  printPriorityDistribution(issues);

  // 4. Stable-sort
  const sorted = stableSortByPriority(issues);
  const currentKeys = issues.map((i) => i.key);
  const sortedKeys = sorted.map((i) => i.key);

  // 5. Check if already sorted
  const alreadySorted = currentKeys.every((k, i) => k === sortedKeys[i]);
  if (alreadySorted) {
    console.log('✅ Backlog is already sorted by priority. No changes needed.');
    return;
  }

  printChangeSummary(currentKeys, sortedKeys);

  // 6. Re-rank
  if (!live) printTopPreview(sorted);

  const calls = await rerank(authHeader, sortedKeys, currentKeys[0], live);

  if (live) {
    console.log(`✅ Backlog re-ranked. ${String(calls)} API call(s).`);
  } else {
    console.log(
      `[dry-run] Would make ~${String(Math.ceil(sortedKeys.length / RANK_BATCH_SIZE))} API call(s). Run with --live to apply.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
