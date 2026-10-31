/**
 * @module slack/channel-meta/worker-batch
 *
 * The worker step for the channels that need text: their snapshot goes
 * to the run directory (`channel-meta/snapshot`; a live run keeps the newest
 * {@link KEEP_RUNS}, `lib/run-dirs`, and a preview deletes none, so it
 * never removes a live run's record), ONE worker with no Slack rights is dispatched
 * with the TASK (`channel-meta/task`), and its `result.json` is checked
 * (`channel-meta/apply-result`). On a live run each accepted value is set and
 * verified, recording what was set in the next state; without `--live`
 * the worker runs just the same but nothing is set or recorded: each value
 * comes back as `proposed` beside the channel's current one.
 * `--print-task` only prints the TASK (core) and reports each field as
 * `would-update`. A result that is missing or breaks the contract sets
 * nothing and is returned as the worker problem: fixed wording and
 * counts that point at {@link WORKER_PROBLEM_FILE} in the run directory
 * (`channel-meta/result`), since the report may go to another workspace and the
 * full diagnostic can quote the result. The diagnostic itself goes only
 * to that file and the job's stderr log.
 *
 * `dispatchWithSlack` previews instead of dispatching when its own
 * `dryRun` flag is set, so a worker is always dispatched with
 * {@link WORKER_FLAGS} (both flags explicitly off, so the runnable's own
 * `--live` and `--print-task` never reach it through `process.argv`):
 * the preview is decided here, and the worker has no Slack post targets
 * either way. `--print-task` dispatches with {@link PRINT_TASK_FLAGS}.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import type { DispatcherFlags } from '../../lib/dispatcher-flags.js';
import { pruneRuns } from '../../lib/run-dirs.js';
import {
  type ApplyFn,
  applyResult,
  proposeResult,
  type Wanted,
} from './apply-result.js';
import type { FieldOutcome } from './report-input.js';
import { stderrWarn } from './report-safe.js';
import { WorkerResultError } from './result.js';
import type { ChannelMetaSettings } from './settings.js';
import { type SnapshotChannel, writeSnapshot } from './snapshot.js';
import type { JobState } from './state.js';
import { buildTask } from './task.js';

/** Run directories kept. */
export const KEEP_RUNS = 14;

/** The full diagnostic of an unusable worker result, in the run
 * directory. */
export const WORKER_PROBLEM_FILE = 'worker-problem.txt';

/** The runnable's flags: `--live` sets values and delivers; `--print-task` prints the TASK. */
export interface RunFlags {
  /** `--live`: set values, write and post the report. */
  live: boolean;
  /** `--print-task`: print the worker's TASK and dispatch nothing. */
  printTask: boolean;
}

/** The flags of every real worker dispatch: the worker is dispatched,
 * never previewed (a preview stops before anything is set). */
export const WORKER_FLAGS: DispatcherFlags = {
  dryRun: false,
  printTask: false,
};

/** `--print-task`: print the TASK, dispatch nothing. */
export const PRINT_TASK_FLAGS: DispatcherFlags = {
  dryRun: false,
  printTask: true,
};

/** The worker step's side effects. */
export interface BatchDeps {
  /** Directory holding run directories. */
  runsRoot: string;
  /** `dispatchWithSlack` bound to the job, with no Slack rights. */
  dispatch: (task: string, flags: DispatcherFlags) => Promise<unknown>;
  /** File access (the worker's `result.json`). */
  io: { readText: (file: string) => string | undefined };
  /** Set one field with the workspace's bot and verify it. */
  apply: ApplyFn;
}

/** What the worker step did. */
export interface BatchResult {
  /** Per-field outcomes. */
  outcomes: FieldOutcome[];
  /** Why the worker's result couldn't be used, if it couldn't (safe for
   * the report: no text from the result). */
  workerProblem?: string;
}

/**
 * Keep an unusable result's full diagnostic in the run directory and the
 * job's stderr log; return what the report says.
 *
 * @param runDir - This run's directory.
 * @param e - What checking the result threw.
 * @returns Fixed wording and counts, and where the details are.
 */
const workerProblem = (runDir: string, e: unknown): string => {
  const file = path.join(runDir, WORKER_PROBLEM_FILE);
  fs.writeFileSync(file, `${getErrorMessage(e)}\n`);
  stderrWarn(
    `[warn] slack/refresh-channel-meta: the worker's result is unusable (${file}): ${getErrorMessage(e)}`,
  );
  const summary =
    e instanceof WorkerResultError
      ? e.summary
      : "the worker's result could not be used";
  return `${summary}; details in ${WORKER_PROBLEM_FILE} in run directory ${path.basename(runDir)}`;
};

const snapshotChannel = ({ facts: f, fields }: Wanted): SnapshotChannel[] =>
  f.meta === undefined
    ? []
    : [
        {
          id: f.channel.id,
          name: f.channel.name,
          fields: [...fields],
          purpose: f.channel.purpose,
          topic: f.channel.topic,
          meta: f.meta,
          messages: f.recent,
        },
      ];

/**
 * One outcome per wanted field, all with the same status.
 *
 * @param wanted - Channels and their fields.
 * @param status - `deferred` (over the batch cap) or `would-update`
 *   (a preview; the plan's reason as the detail).
 * @returns The outcomes.
 */
export const outcomesOf = (
  wanted: readonly Wanted[],
  status: 'deferred' | 'would-update',
): FieldOutcome[] =>
  wanted.flatMap((w) =>
    w.fields.map((field) => ({
      id: w.id,
      field,
      status,
      ...(status === 'would-update' ? { detail: w.reasons[field] } : {}),
    })),
  );

/**
 * Snapshot, dispatch and check one batch; apply it on a live run.
 *
 * @param runDir - This run's directory (under `runsRoot`).
 * @param batch - The channels sent to the worker (non-empty).
 * @param settings - Caps and the activity window.
 * @param flags - `live` / `printTask`.
 * @param next - The next state; values set are recorded in it.
 * @param now - The run's clock reading.
 * @param deps - Side effects.
 * @returns The outcomes and any worker problem.
 */
export async function runBatch(
  runDir: string,
  batch: readonly Wanted[],
  settings: ChannelMetaSettings,
  flags: RunFlags,
  next: JobState,
  now: Date,
  deps: BatchDeps,
): Promise<BatchResult> {
  const limits = {
    descriptionMaxChars: settings.descriptionMaxChars,
    topicMaxChars: settings.topicMaxChars,
    activityDays: settings.activityDays,
  };
  const snapshot = writeSnapshot(
    runDir,
    batch.flatMap(snapshotChannel),
    limits,
  );
  if (flags.live && !flags.printTask) pruneRuns(deps.runsRoot, KEEP_RUNS);
  const channelIds = batch.map((w) => w.id);
  const task = buildTask({ ...snapshot, ...limits, channelIds });
  if (flags.printTask) {
    await deps.dispatch(task, PRINT_TASK_FLAGS);
    return { outcomes: outcomesOf(batch, 'would-update') };
  }
  await deps.dispatch(task, WORKER_FLAGS);
  try {
    const caps = {
      description: settings.descriptionMaxChars,
      topic: settings.topicMaxChars,
    };
    const resultText = deps.io.readText(snapshot.resultFile);
    return {
      outcomes: flags.live
        ? await applyResult(resultText, batch, caps, next, now, deps.apply)
        : proposeResult(resultText, batch, caps),
    };
  } catch (e) {
    return { outcomes: [], workerProblem: workerProblem(runDir, e) };
  }
}
