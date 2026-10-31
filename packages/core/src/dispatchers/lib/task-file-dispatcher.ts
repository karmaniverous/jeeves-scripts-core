/**
 * @module dispatchers/lib/task-file-dispatcher
 *
 * Generic task-file dispatcher (Decisions 23, 28): reads a standing-order
 * Markdown task from a data silo and dispatches a gateway worker session
 * to execute it. Used by instance dispatchers (e.g. a daily digest, or
 * per-organisation briefings in their own silo); core ships none.
 *
 * - The task file path is relative to a silo (`siloPath(silo, [taskFile])`);
 *   the instance config's `jobs.<jobId>.silo` / `.taskFile` override the
 *   caller's values, so an instance can move a task without code.
 * - A missing task file is a `[skip]` (the job is not configured yet),
 *   unless the caller names a core `template`: then core's copy is the
 *   task (Decision 75; `lib/task-template`). Every run logs which source
 *   it used. With `template` or `templateVars`, `{{name}}` placeholders
 *   and `{{> core/template.md}}` includes are filled, and `{{runMode}}` is
 *   always available: `scheduled` when jeeves-runner started the run (it
 *   sets `JR_RUN_ID` for every job it runs), else `on-demand` (e.g.
 *   `jeeves-scripts run <id>` from a session). A `runMode` in
 *   `templateVars` wins.
 * - With `dateTimeZone`, the task is prefixed with today's date in that
 *   zone (`withDateContext`). There is no default zone (Decision 26).
 * - With `slack`, dispatch goes through `dispatchWithSlack` (job-side Slack
 *   reads and posts); without it, through jeeves-runner's `runDispatcher`
 *   and core's `spawn-worker`.
 * - `--print-task` prints the full task and dispatches nothing, with or
 *   without `slack`. `--dry-run` reports what it would dispatch (job, task
 *   length and, with `slack`, the allowed post targets) and dispatches
 *   nothing, with or without `slack`: it never starts a worker session.
 *
 * Side effects: reads the config and the task file; spawns a worker.
 */

import type { DispatchOptions } from '@karmaniverous/jeeves-runner';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { loadConfig } from '../../config/loader.js';
import { siloPath } from '../../config/silo-router.js';
import { constants } from '../../lib/constants.js';
import { withDateContext } from '../../lib/dates.js';
import {
  declaredDispatcherFlags,
  type DispatcherFlags,
  resolveDispatcherFlags,
} from '../../lib/dispatcher-flags.js';
import {
  describeTaskSource,
  fillTaskTemplate,
  resolveTaskTemplate,
} from '../../lib/task-template.js';
import { dispatchWithSlack } from '../../lib/worker-slack/run.js';
import type { WorkerSlackConfig } from '../../lib/worker-slack/worker-slack-config.js';

/** A value, or a function evaluated inside the run (so its errors fail the run). */
export type Lazy<T> = T | (() => T);

/** Options for {@link taskFileDispatcher} and {@link dispatchTaskFile}. */
export interface TaskFileDispatcherOptions extends DispatchOptions {
  /** Name for the `[skip]` line, e.g. `acme/daily-briefing`. */
  scriptName: string;
  /** Task file path relative to the silo, e.g. `briefing/TASK.md`. */
  taskFile: string;
  /**
   * Core TASK template used when the instance has no file at `taskFile`
   * (Decision 75), e.g. `BRIEFING_TEMPLATES.morning`. Unset: a missing
   * task file skips the run.
   */
  template?: string;
  /** Values for the task's `{{name}}` placeholders (e.g. {@link briefingVars}). */
  templateVars?: Lazy<Readonly<Record<string, string>>>;
  /** Data silo holding the task file. Default: the default silo. */
  silo?: string;
  /** IANA time zone; when set, the task is prefixed with today's date in it. */
  dateTimeZone?: Lazy<string>;
  /** Job-side Slack reads and allowed post targets (see `lib/worker-slack`). */
  slack?: Lazy<WorkerSlackConfig>;
  /**
   * The parsed dispatcher flags (`ctx.flags` of a job that declares
   * `flags: dispatcherFlags`). Wins over `args`.
   */
  flags?: Partial<DispatcherFlags>;
  /**
   * The runnable's arguments (`ctx.args`), read for `--print-task` and
   * `--dry-run` when `flags` is unset. Default: `process.argv`, for callers
   * written before the flags were read from here.
   */
  args?: readonly string[];
}

/** How a dispatcher run was started, for a template's `{{runMode}}`. */
export type RunMode = 'scheduled' | 'on-demand';

/**
 * `scheduled` when jeeves-runner started this process (it sets `JR_RUN_ID`
 * for every job run, on schedule or by `runner_trigger`), else
 * `on-demand`.
 */
export const runModeOf = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): RunMode => (env.JR_RUN_ID ? 'scheduled' : 'on-demand');

/** Collaborators of {@link dispatchTaskFile}, injectable for tests. */
export interface TaskFileDispatcherDeps {
  /** How this run was started. Default: {@link runModeOf} the process environment. */
  runMode?: () => RunMode;
  /** Dispatch with job-side Slack I/O. Default: `lib/worker-slack`'s `dispatchWithSlack`. */
  dispatchWithSlack: typeof dispatchWithSlack;
  /** Dispatch without Slack. Default: jeeves-runner's `runDispatcher` with core's `spawn-worker`. */
  runDispatcher: (task: string, options: DispatchOptions) => void;
  /** The current time, for the date context. */
  now: () => Date;
  /** Logs the `[skip]` line and the previews. */
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
 * @returns `'skipped'` when the task file does not exist, `'previewed'`
 *   for `--print-task` or `--dry-run`, else `'dispatched'`.
 */
export const dispatchTaskFile = async (
  options: TaskFileDispatcherOptions,
  deps: TaskFileDispatcherDeps = defaultDeps,
): Promise<'skipped' | 'previewed' | 'dispatched'> => {
  const {
    scriptName,
    taskFile,
    template,
    templateVars,
    silo,
    dateTimeZone,
    slack,
    flags: declared,
    args,
    ...dispatchOptions
  } = options;
  const flags = resolveDispatcherFlags(declared ?? args);
  const file = resolveTaskFile({
    jobId: dispatchOptions.jobId,
    silo,
    taskFile,
  });
  const resolved = resolveTaskTemplate(file, template);
  if (resolved === undefined) {
    deps.log(`[skip] ${scriptName}: no task file at ${file}`);
    return 'skipped';
  }
  deps.log(`${scriptName}: ${describeTaskSource(resolved)}`);

  let task =
    template === undefined && templateVars === undefined
      ? resolved.text
      : fillTaskTemplate(resolved.text, {
          runMode: (deps.runMode ?? runModeOf)(),
          ...resolve(templateVars ?? {}),
        });
  if (dateTimeZone !== undefined)
    task = withDateContext(task, deps.now(), resolve(dateTimeZone));

  if (slack !== undefined) {
    // The Slack path handles both flags (it adds the Slack context first);
    // neither starts a worker.
    await deps.dispatchWithSlack(task, dispatchOptions, resolve(slack), flags);
    return flags.printTask || flags.dryRun ? 'previewed' : 'dispatched';
  }
  if (flags.printTask) {
    deps.log(task);
    return 'previewed';
  }
  if (flags.dryRun) {
    deps.log(
      `[dry-run] ${scriptName}: would dispatch job ${dispatchOptions.jobId} with a ${String(task.length)}-character task`,
    );
    return 'previewed';
  }
  deps.runDispatcher(task, dispatchOptions);
  return 'dispatched';
};

/**
 * A runnable's `run` that dispatches the task file: {@link dispatchTaskFile}
 * with these options. Pass it to `defineRunnable`, which runs it under the
 * crash handler (Decision 57); nothing runs until the job does.
 *
 * @example
 * ```ts
 * export default defineRunnable({
 *   id: 'acme-daily-briefing',
 *   domain: 'acme',
 *   flags: dispatcherFlags,
 *   run: taskFileDispatcher({
 *     scriptName: 'acme/daily-briefing',
 *     jobId: 'acme-daily-briefing',
 *     taskFile: 'tasks/daily-briefing.md',
 *   }),
 * });
 * ```
 */
export const taskFileDispatcher =
  (
    options: TaskFileDispatcherOptions,
  ): ((ctx?: { args: readonly string[]; flags?: object }) => Promise<void>) =>
  async (ctx) => {
    await dispatchTaskFile({
      args: ctx?.args,
      flags: declaredDispatcherFlags(ctx?.flags),
      ...options,
    });
  };
