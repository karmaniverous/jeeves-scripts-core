/**
 * @module punch-list/harvest/worker
 *
 * Dispatch the harvest worker and read its report. The
 * worker runs through jeeves-runner's `dispatchSession` and core's
 * `spawn-worker` (the same path as every runner dispatcher), with low
 * thinking. It writes its report to the file named in its
 * task; the script reads that file. No session history is read.
 *
 * Side effects: spawns a gateway session; reads one file.
 */

import { existsSync, readFileSync } from 'node:fs';

import { dispatchSession } from '@karmaniverous/jeeves-runner';

import { constants } from '../../lib/constants.js';

/** Runs a task in a worker session and resolves the report it wrote to `reportFile`. */
export type HarvestWorker = (
  task: string,
  reportFile: string,
) => Promise<string>;

/** The live worker. */
export const liveHarvestWorker =
  (jobId: string): HarvestWorker =>
  async (task, reportFile) => {
    const { exitCode } = await dispatchSession(
      task,
      { jobId, label: jobId, thinking: 'low' },
      constants().SPAWN_WORKER_PATH,
    );
    if (exitCode !== 0)
      throw new Error(`harvest worker exited ${String(exitCode)}`);
    if (!existsSync(reportFile)) {
      throw new Error(`harvest worker wrote no report to ${reportFile}`);
    }
    return readFileSync(reportFile, 'utf8');
  };
