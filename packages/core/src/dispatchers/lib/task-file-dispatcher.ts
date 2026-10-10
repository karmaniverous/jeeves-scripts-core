/**
 * @module dispatchers/lib/task-file-dispatcher
 *
 * Generic task-file dispatcher (Decisions 23, 28): reads a standing-order
 * Markdown task from a data silo and dispatches a gateway worker session
 * to execute it. Used by core's `daily-digest` and by instance dispatchers
 * (e.g. JGS's `vc/*`).
 *
 * - The task file path is relative to a silo (`siloPath(silo, [taskFile])`);
 *   the instance config's `jobs.<jobId>.silo` / `.taskFile` override the
 *   caller's values, so an instance can move a task without code.
 * - A missing task file is a `[skip]` (the job is not configured yet).
 * - With `dateTimeZone`, the task is prefixed with today's date in that
 *   zone (`withDateContext`). There is no default zone (Decision 26).
 * - With `slack`, dispatch goes through `dispatchWithSlack` (job-side Slack
 *   reads and posts, `--dry-run`, `--print-task`); without it, through
 *   jeeves-runner's `runDispatcher` and core's `spawn-worker`.
 *
 * Side effects: reads the config and the task file; spawns a worker.
 */

import fs from 'node:fs';

import { runScript } from '@karmaniverous/jeeves';
import type { DispatchOptions } from '@karmaniverous/jeeves-runner';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { loadConfig } from '../../config/loader.js';
import { siloPath } from '../../config/silo-router.js';
import { constants } from '../../lib/constants.js';
import { withDateContext } from '../../lib/dates.js';
import { dispatchWithSlack } from '../../lib/worker-slack/run.js';
import type { WorkerSlackConfig } from '../../lib/worker-slack/worker-slack-config.js';

/** A value, or a function evaluated inside the run (so its errors fail the run). */
export type Lazy<T> = T | (() => T);

/** Options for {@link taskFileDispatcher} and {@link dispatchTaskFile}. */
export interface TaskFileDispatcherOptions extends DispatchOptions {
  /** Script name for the `runScript` crash handler, e.g. `dispatchers/daily-digest`. */
  scriptName: string;
  /** Task file path relative to the silo, e.g. `digest/TASK.md`. */
  taskFile: string;
  /** Data silo holding the task file. Default: the default silo. */
  silo?: string;
  /** IANA time zone; when set, the task is prefixed with today's date in it. */
  dateTimeZone?: Lazy<string>;
  /** Job-side Slack reads and allowed post targets (see `lib/worker-slack`). */
  slack?: Lazy<WorkerSlackConfig>;
}

/** Collaborators of {@link dispatchTaskFile}, injectable for tests. */
export interface TaskFileDispatcherDeps {
  /** Dispatch with job-side Slack I/O. Default: `lib/worker-slack`'s `dispatchWithSlack`. */
  dispatchWithSlack: typeof dispatchWithSlack;
  /** Dispatch without Slack. Default: jeeves-runner's `runDispatcher` with core's `spawn-worker`. */
  runDispatcher: (task: string, options: DispatchOptions) => void;
  /** The current time, for the date context. */
  now: () => Date;
  /** Logs the `[skip]` line. */
  log: (message: string) => void;
}

const defaultDeps: TaskFileDispatcherDeps = {
  dispatchWithSlack,
  runDispatcher: (task, options) => {
    runDispatcher(task, options, constants().SPAWN_WORKER_PATH);
  },
  now: () => new Date(),
  log: (message) => {
    console.log(message);
  },
};

const resolve = <T>(value: Lazy<T>): T =>
  typeof value === 'function' ? (value as () => T)() : value;

/**
 * The task file's absolute path: the caller's silo and path, overridden by
 * the instance config's `jobs.<jobId>.silo` / `.taskFile`.
 *
 * @throws `UnknownSiloError` when the silo is not configured.
 */
export const resolveTaskFile = (
  options: Pick<TaskFileDispatcherOptions, 'jobId' | 'silo' | 'taskFile'>,
): string => {
  const delta = loadConfig().jobs[options.jobId];
  return siloPath(delta?.silo ?? options.silo, [
    delta?.taskFile ?? options.taskFile,
  ]);
};

/**
 * Read the task and dispatch it (the body of {@link taskFileDispatcher}).
 *
 * @returns `'skipped'` when the task file does not exist, else `'dispatched'`.
 */
export const dispatchTaskFile = async (
  options: TaskFileDispatcherOptions,
  deps: TaskFileDispatcherDeps = defaultDeps,
): Promise<'skipped' | 'dispatched'> => {
  const {
    scriptName,
    taskFile,
    silo,
    dateTimeZone,
    slack,
    ...dispatchOptions
  } = options;
  const file = resolveTaskFile({
    jobId: dispatchOptions.jobId,
    silo,
    taskFile,
  });
  if (!fs.existsSync(file)) {
    deps.log(`[skip] ${scriptName}: no task file at ${file}`);
    return 'skipped';
  }

  let task = fs.readFileSync(file, 'utf8');
  if (dateTimeZone !== undefined)
    task = withDateContext(task, deps.now(), resolve(dateTimeZone));

  if (slack === undefined) deps.runDispatcher(task, dispatchOptions);
  else await deps.dispatchWithSlack(task, dispatchOptions, resolve(slack));
  return 'dispatched';
};

/**
 * Run {@link dispatchTaskFile} as a script: `runScript` logs, handles
 * crashes and sets the exit code.
 */
export function taskFileDispatcher(options: TaskFileDispatcherOptions): void {
  runScript(options.scriptName, async () => {
    await dispatchTaskFile(options);
  });
}
