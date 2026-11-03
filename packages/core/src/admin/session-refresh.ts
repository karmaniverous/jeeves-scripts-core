/**
 * @module admin/session-refresh
 *
 * Runnable `admin-refresh-sessions` (spec 2.12, #73): resets idle
 * top-level gateway sessions whose last turn carried a large context.
 * Every top-level session of every agent is considered (main sessions,
 * channels and DMs on any channel; subagent, cron and spawned sessions
 * are out of scope). Sessions are listed and reset through the gateway
 * (`sessions.list`, then just before each live reset `sessions.describe`
 * and `sessions.list` with `activeOnly: true`, then `sessions.reset`
 * fenced with `expectedSessionId`); last-turn usage comes from the agent DB, read-only.
 * A busy or recently active session is never touched. After a live reset
 * of a Slack session, one line is posted in its conversation.
 *
 * **Flags.** Without `--live` the run is a dry run: it lists, reads and
 * logs what it would reset, and writes nothing. `--live` resets.
 *
 * **Config.** `contextThreshold`, `idleMinutes` and `excludedKeys` on the
 * job's delta (`jobs."admin-refresh-sessions"`); no fields means the
 * defaults. A still-set retired environment variable fails the run.
 *
 * **Failure.** A failed or malformed list, or an unreadable agent DB, fails
 * the run; so does any failed reset, after the other sessions are tried.
 *
 * **Manifest.** `jobs/admin.json`, every 23 minutes, shipped disabled with
 * no arguments (a dry run); the enabling delta adds `--live`.
 */

import { argFlag } from '@karmaniverous/jeeves';

import { defineRunnable } from '../runnables/define-runnable.js';
import { sessionGateway } from './lib/session-refresh-gateway.js';
import {
  JOB_ID,
  liveRpc,
  liveSettings,
  liveSlack,
  openUsageReader,
  sessionRefreshDoctorCheck,
} from './lib/session-refresh-live.js';
import { postResetNotice } from './lib/session-refresh-notice.js';
import { sessionRefresh } from './lib/session-refresh-run.js';

/** The runnable's flags. */
export const sessionRefreshFlags = {
  live: argFlag(
    '--live',
    'Reset due sessions and post the Slack notices (default: dry run, writes nothing)',
  ),
};

/**
 * Run the refresh with the live collaborators; a failed reset sets exit
 * code 1.
 *
 * @param live - Reset (`--live`), else a dry run.
 * @throws When the settings, the list or an agent DB fail.
 */
export async function runSessionRefresh(live: boolean): Promise<void> {
  const settings = liveSettings();
  const reader = openUsageReader();
  try {
    const summary = await sessionRefresh({
      settings,
      live,
      gateway: sessionGateway(liveRpc),
      usage: reader.usage,
      notify: (row) => postResetNotice(row, liveSlack),
      now: Date.now,
    });
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    reader.close();
  }
}

export default defineRunnable({
  id: JOB_ID,
  domain: 'admin',
  flags: sessionRefreshFlags,
  name: 'session-refresh',
  doctorCheck: () => sessionRefreshDoctorCheck(),
  run: ({ flags }) => runSessionRefresh(flags.live),
});
