/**
 * @module punch-list/harvest/job
 *
 * Runnable `punch-list-harvest` (spec 2.7, #45): the punch list's daily
 * harvester once enabled. Finds platform work in the instance's archive
 * and telemetry through one worker session and files it to the Backlog.
 * `--print-task` prints the worker's task and where it came from (the
 * instance's `{dir}/TASK.md` or core's template) and dispatches nothing;
 * without `--live` it dispatches the worker but writes and posts nothing.
 * Skips (exit 0) when the instance config has no `punchList` block.
 */

import { argFlag } from '../../lib/args.js';
import { defineRunnable } from '../../runnables/define-runnable.js';
import { punchListConfig } from '../config.js';
import {
  liveJobDeps,
  NO_PUNCH_LIST,
  punchListPrerequisite,
} from '../runtime.js';
import { runHarvest } from './run.js';
import { liveHarvestWorker } from './worker.js';

/** The harvester's runnable id. */
export const HARVEST_JOB_ID = 'punch-list-harvest';

/** The flags `punch-list-harvest` accepts. */
export const harvestFlags = {
  live: argFlag(
    '--live',
    'Write the file, record and cursor and post (default: dry run)',
  ),
  printTask: argFlag(
    '--print-task',
    "Print the worker's task and its source; dispatch nothing",
  ),
};

export default defineRunnable({
  id: HARVEST_JOB_ID,
  domain: 'punch-list',
  flags: harvestFlags,
  prerequisite: () => punchListPrerequisite(punchListConfig()),
  run: async ({ flags }) => {
    const config = punchListConfig();
    if (!config) {
      console.log(`[skip] ${NO_PUNCH_LIST}`);
      return;
    }
    await runHarvest(
      config,
      { live: flags.live, printTask: flags.printTask },
      {
        ...liveJobDeps(config, HARVEST_JOB_ID),
        worker: liveHarvestWorker(HARVEST_JOB_ID),
      },
    );
  },
});
