/**
 * @module linear/backfill
 *
 * One-time Linear backfill: populates the issue (or comment) archive under
 * `{silo}/linear` from the GraphQL API by cursor pagination
 * (`linear/lib/linear-sync`). Existing entity files are skipped
 * (webhook and sync data is fresher). Dry run unless `--live`.
 *
 * Usage:
 *   jeeves-scripts run linear-backfill --team ACME [--type issue] [--live]
 *
 * Arguments:
 *   --team KEY   Linear team key, e.g. ACME (required for type=issue)
 *   --type TYPE  Entity type to backfill: issue | comment (default: issue)
 *   --live       Perform actual writes (default: dry run)
 */

import { defineJob } from '../jobs/define-job.js';
import { argFlag, argValue, parseRunnableArgs } from '../lib/args.js';
import { backfillEntity } from '../lib/entity-store.js';
import {
  forEachLinearEntity,
  linearConfigOrSkip,
  type LinearJobDeps,
  linearJobDeps,
} from './lib/linear-sync.js';

const argSpec = {
  team: argValue('--team'),
  type: argValue('--type', 'issue'),
  live: argFlag('--live'),
};

/**
 * Run the backfill. Missing credentials skip; an unsupported `--type`, an
 * issue backfill without `--team` or any failed entity sets exit code 1.
 */
export async function linearBackfill(
  args: readonly string[],
  deps: LinearJobDeps,
): Promise<void> {
  const config = linearConfigOrSkip(deps);
  if (!config) return;
  const { team, type, live } = parseRunnableArgs(args, argSpec);
  if (type !== 'issue' && type !== 'comment') {
    console.error(
      `[error] --type "${type}" is not supported (only "issue" or "comment")`,
    );
    process.exitCode = 1;
    return;
  }
  if (type === 'issue' && !team) {
    console.error('[error] --team <key> is required for --type issue');
    process.exitCode = 1;
    return;
  }

  console.log(
    `[backfill] team=${team || '(all)'} type=${type} live=${String(live)}`,
  );
  if (!live)
    console.log('[backfill] DRY-RUN mode \u2014 pass --live for actual writes');

  const now = deps.now();
  const entities =
    type === 'issue'
      ? deps.paginate.issue(config, team)
      : deps.paginate.comment(config);
  const tally = await forEachLinearEntity(
    type,
    entities,
    '[backfill]',
    (key, snapshot, label) => {
      if (!live) {
        console.log(`[backfill] dry-run ${label}`);
        return false;
      }
      const written = backfillEntity(deps.domainDir, type, key, snapshot, now);
      console.log(
        written
          ? `[backfill] created ${label}`
          : `[backfill] skip   ${label} (exists)`,
      );
      return written !== null;
    },
    deps,
  );
  console.log(
    `[backfill] done \u2014 created=${String(tally.stored)} skipped=${String(tally.skipped)} failed=${String(tally.failed)}`,
  );
  if (tally.failed > 0) process.exitCode = 1;
}

export default defineJob({
  id: 'linear-backfill',
  domain: 'linear',
  description:
    'Seed the Linear issue or comment archive from a team (dry run unless --live).',
  name: 'linear/backfill',
  run: ({ args }) => linearBackfill(args, linearJobDeps()),
});
