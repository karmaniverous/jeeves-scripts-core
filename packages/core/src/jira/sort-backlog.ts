/**
 * @module jira/sort-backlog
 *
 * Stable-sorts a Jira board's backlog by priority group: issues keep their
 * relative order within a group, and the groups run no-priority first,
 * then Highest to Lowest. Epics are left alone. Dry run unless `--live`.
 *
 * Usage:
 *   jeeves-scripts run jira-sort-backlog          # dry run (default)
 *   jeeves-scripts run jira-sort-backlog --live   # re-rank
 *
 * The board is `integrations.jira.boardId` (`JIRA_BOARD_ID` wins,
 * Decision 53); without one the run fails (exit 1) before anything else.
 */

import { defineJob } from '../jobs/define-job.js';
import { flag, parseRunnableArgs } from '../lib/args.js';
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
import {
  hasJiraCredentials,
  type JiraConnection,
  jiraConnection,
} from './lib/jira-client.js';
import { type JiraJobDeps, jiraJobDeps } from './lib/jira-deps.js';

/** Execute (live) or log (dry run) the planned rank calls; returns the call count. */
async function rerank(
  conn: JiraConnection,
  sortedKeys: string[],
  currentFirstKey: string,
  live: boolean,
): Promise<number> {
  const ops = planRerank(sortedKeys, currentFirstKey);
  for (const op of ops) {
    if (live) await agilePut(conn, 'issue/rank', op.body);
    else console.log(op.dryRunMessage);
  }
  return ops.length;
}

/** Sort the backlog of `boardId`. */
async function sortBoard(
  conn: JiraConnection,
  boardId: number,
  live: boolean,
): Promise<void> {
  console.log(`Fetching backlog from board ${String(boardId)}...`);
  const backlog = await fetchBacklog(conn, boardId);
  console.log(`  ${String(backlog.length)} issues in backlog\n`);
  if (backlog.length <= 1) {
    console.log('Nothing to sort.');
    return;
  }
  console.log(`  (${String(backlog.length)} total, filtering epics next)`);

  const epics = backlog.filter((i) => i.fields.issuetype?.name === 'Epic');
  const issues = backlog.filter((i) => i.fields.issuetype?.name !== 'Epic');
  if (epics.length > 0)
    console.log(
      `  Skipping ${String(epics.length)} epic(s) \u2014 not included in sort\n`,
    );

  printPriorityDistribution(issues);
  const sorted = stableSortByPriority(issues);
  const currentKeys = issues.map((i) => i.key);
  const sortedKeys = sorted.map((i) => i.key);
  if (currentKeys.every((k, i) => k === sortedKeys[i])) {
    console.log(
      '\u2705 Backlog is already sorted by priority. No changes needed.',
    );
    return;
  }
  printChangeSummary(currentKeys, sortedKeys);
  if (!live) printTopPreview(sorted);

  // Non-empty: an empty list counts as already sorted above.
  const firstKey = currentKeys[0] ?? '';
  const calls = await rerank(conn, sortedKeys, firstKey, live);
  if (live)
    console.log(`\u2705 Backlog re-ranked. ${String(calls)} API call(s).`);
  else
    console.log(
      `[dry-run] Would make ~${String(Math.ceil(sortedKeys.length / RANK_BATCH_SIZE))} API call(s). Run with --live to apply.`,
    );
}

/**
 * Run the sort. No board id sets exit code 1; missing credentials skip.
 */
export async function sortJiraBacklog(
  args: readonly string[],
  deps: JiraJobDeps,
): Promise<void> {
  const { boardId } = deps;
  if (!boardId) {
    console.error(
      'Error: set integrations.jira.boardId in jeeves-scripts.json (or the JIRA_BOARD_ID environment variable) to your Jira board ID.',
    );
    process.exitCode = 1;
    return;
  }
  const { live } = parseRunnableArgs(args, { live: flag('--live') });
  console.log(
    `\n=== Jira Backlog Priority Sort (${live ? 'LIVE' : 'DRY-RUN'}) ===\n`,
  );
  if (!hasJiraCredentials(deps.settings)) {
    console.log('[skip] Jira API credentials not configured');
    return;
  }
  await sortBoard(jiraConnection(deps.settings, deps.fetch), boardId, live);
}

export default defineJob({
  id: 'jira-sort-backlog',
  domain: 'jira',
  name: 'jira/sort-backlog',
  run: ({ args }) => sortJiraBacklog(args, jiraJobDeps()),
});
