/**
 * @module jira/backfill
 *
 * One-time Jira backfill: populates the issue archive (`{silo}/jira/issue`)
 * from a project's full backlog through the REST API. Existing entity files
 * are skipped (webhook data is fresher). Dry run unless `--live`.
 *
 * Usage:
 *   jeeves-scripts run jira-backfill --project ACME [--type issue] [--live]
 *
 * Arguments:
 *   --project <key>  Jira project key, e.g. ACME (required)
 *   --type <type>    Entity type to backfill (default: issue; the only one supported)
 *   --live           Perform actual writes (default: dry run)
 */

import { defineJob } from '../jobs/define-job.js';
import { argFlag, argValue, parseRunnableArgs } from '../lib/args.js';
import { backfillEntity } from '../lib/entity-store.js';
import {
  hasJiraCredentials,
  type JiraConnection,
  jiraConnection,
  searchIssues,
} from './lib/jira-client.js';
import { type JiraJobDeps, jiraJobDeps } from './lib/jira-deps.js';

/** Delay between issues. */
export const RATE_LIMIT_MS = 200;

const argSpec = {
  project: argValue('--project'),
  type: argValue('--type', 'issue'),
  live: argFlag('--live'),
};

interface Tally {
  created: number;
  skipped: number;
  failed: number;
}

async function backfillIssues(
  conn: JiraConnection,
  projectKey: string,
  live: boolean,
  deps: JiraJobDeps,
): Promise<Tally> {
  const tally: Tally = { created: 0, skipped: 0, failed: 0 };
  const now = deps.now();
  const jql = `project = ${projectKey} ORDER BY created ASC`;
  for await (const issue of searchIssues(conn, jql)) {
    try {
      if (live) {
        const written = backfillEntity(
          deps.domainDir,
          'issue',
          issue.key,
          { id: issue.id, key: issue.key, fields: issue.fields },
          now,
        );
        if (written) {
          tally.created++;
          console.log(`[backfill] created ${issue.key}`);
        } else {
          tally.skipped++;
          console.log(`[backfill] skip   ${issue.key} (exists)`);
        }
      } else {
        console.log(`[backfill] dry-run ${issue.key}`);
        tally.skipped++;
      }
    } catch (e) {
      tally.failed++;
      console.error(
        `[backfill] error ${issue.key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await deps.sleep(RATE_LIMIT_MS);
  }
  return tally;
}

/**
 * Run the backfill. A missing credential skips (exit 0); a missing
 * `--project`, an unsupported `--type` or any failed issue sets exit code 1.
 */
export async function jiraBackfill(
  args: readonly string[],
  deps: JiraJobDeps,
): Promise<void> {
  if (!hasJiraCredentials(deps.settings)) {
    console.log('[skip] Jira API credentials not configured');
    return;
  }
  const { project, type, live } = parseRunnableArgs(args, argSpec);
  if (!project) {
    console.error('[error] --project <key> is required');
    process.exitCode = 1;
    return;
  }
  if (type !== 'issue') {
    console.error(
      `[error] --type "${type}" is not yet supported (only "issue")`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[backfill] project=${project} type=${type} live=${String(live)}`,
  );
  if (!live)
    console.log('[backfill] DRY-RUN mode \u2014 pass --live for actual writes');

  const conn = jiraConnection(deps.settings, deps.fetch);
  const { created, skipped, failed } = await backfillIssues(
    conn,
    project,
    live,
    deps,
  );
  console.log(
    `[backfill] done \u2014 created=${String(created)} skipped=${String(skipped)} failed=${String(failed)}`,
  );
  if (failed > 0) process.exitCode = 1;
}

export default defineJob({
  id: 'jira-backfill',
  domain: 'jira',
  description:
    'Seed the Jira issue archive from a project backlog (dry run unless --live).',
  name: 'jira/backfill',
  run: ({ args }) => jiraBackfill(args, jiraJobDeps()),
});
