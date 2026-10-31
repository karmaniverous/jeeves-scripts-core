/**
 * @module punch-list/status/job
 *
 * Runnable `punch-list-refresh-status` (spec 2.7, #45): the punch list's
 * status checker, every 61 minutes once enabled. Applies checkbox ticks,
 * follows each milestone's GitHub issues to release and install, writes
 * today's file and posts transitions. Dry run unless `--live` (computes
 * and logs the file and the post, writes and posts nothing). Skips (exit
 * 0) when the instance config has no `punchList` block.
 */

import { argFlag } from '@karmaniverous/jeeves';

import { defineRunnable } from '../../runnables/define-runnable.js';
import { punchListConfig } from '../config.js';
import { liveInstallEnv } from '../github/install.js';
import { liveGitHub } from '../github/port.js';
import {
  liveJobDeps,
  NO_PUNCH_LIST,
  punchListPrerequisite,
} from '../runtime.js';
import { runStatus } from './run.js';

/** The status checker's runnable id. */
export const STATUS_JOB_ID = 'punch-list-refresh-status';

/** The flags `punch-list-refresh-status` accepts. */
export const statusFlags = {
  live: argFlag('--live', 'Write the file and post (default: dry run)'),
};

export default defineRunnable({
  id: STATUS_JOB_ID,
  domain: 'punch-list',
  flags: statusFlags,
  prerequisite: () => punchListPrerequisite(punchListConfig()),
  run: async ({ flags }) => {
    const config = punchListConfig();
    if (!config) {
      console.log(`[skip] ${NO_PUNCH_LIST}`);
      return;
    }
    await runStatus(
      config,
      { live: flags.live },
      {
        ...liveJobDeps(config, STATUS_JOB_ID),
        github: liveGitHub(),
        install: liveInstallEnv,
      },
    );
  },
});
