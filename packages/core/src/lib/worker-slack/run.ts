/**
 * @module worker-slack/run
 *
 * Production wiring for {@link runWorkerSlackJob}: dispatches through
 * jeeves-runner's dispatchSession + spawn-worker.ts, reads the worker's
 * full final reply back via the gateway `chat.history` RPC, and does
 * Slack I/O through the gateway `message` tool.
 *
 * Flags (declared dispatcherFlags, else the raw arguments or process.argv):
 * - `--dry-run`: read Slack, build the TASK, print a one-line report (job,
 *   TASK length, allowed post targets) and stop: no worker, no posts;
 * - `--print-task`: read Slack, print the full TASK, and stop (no dispatch).
 *
 * The job's Slack config is validated here (the dispatch boundary) before
 * any gateway call; an invalid config fails the job.
 *
 * Config dependencies: constants().SPAWN_WORKER_PATH (core's spawn-worker); gateway host/port
 * via gateway-client.ts; the openclaw CLI via gateway-rpc.ts.
 */

import {
  type DispatchOptions,
  dispatchSession,
} from '@karmaniverous/jeeves-runner';

import { constants } from '../constants.js';
import {
  type DispatcherFlags,
  resolveDispatcherFlags,
} from '../dispatcher-flags.js';
import { gatewayInvoke } from '../gateway-client.js';
import { gatewayRpc } from '../gateway-rpc.js';
import { readWorkerFinalText } from '../worker-output.js';
import { gatewaySlackIo } from './slack-io.js';
import {
  parseWorkerSlackConfig,
  type WorkerSlackConfig,
} from './worker-slack-config.js';
import {
  runWorkerSlackJob,
  type WorkerSlackResult,
} from './worker-slack-job.js';

/**
 * Dispatch a worker with job-side Slack I/O.
 *
 * @param task - Base TASK text.
 * @param options - Runner dispatch options (jobId, thinking, timeout, …).
 * @param slackConfig - Reads and allowed post targets (validated here).
 * @param flags - `dryRun` / `printTask` (`lib/dispatcher-flags`), or raw
 *   arguments to read them from (default: `process.argv`).
 * @returns The run result.
 * @throws Error when the Slack config is invalid (before any side effect).
 */
export async function dispatchWithSlack(
  task: string,
  options: DispatchOptions,
  slackConfig: WorkerSlackConfig,
  flags?: readonly string[] | Partial<DispatcherFlags>,
): Promise<WorkerSlackResult> {
  const slack = parseWorkerSlackConfig(slackConfig);
  const { dryRun, printTask } = resolveDispatcherFlags(flags);
  return runWorkerSlackJob(task, slack, {
    slack: gatewaySlackIo(gatewayInvoke, slack.accountId),
    dryRun,
    jobId: options.jobId,
    printTask,
    dispatch: async (fullTask) => {
      const { exitCode, stdout } = await dispatchSession(
        fullTask,
        options,
        constants().SPAWN_WORKER_PATH,
      );
      const finalText =
        exitCode === 0 ? await readWorkerFinalText(stdout, gatewayRpc) : null;
      return { exitCode, finalText };
    },
  });
}
