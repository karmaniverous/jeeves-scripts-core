/**
 * @module runnables/run-job
 *
 * Running a declared runnable (Decisions 4, 40, 49, 79): the context a run
 * receives ({@link jobContext}) and {@link runJobModule}, which runs one the
 * way every entry point used to run itself. The CLI's `run` resolves the
 * id through the registry and calls it.
 *
 * Running a job sets `process.argv` to `[node, <jobId>, ...args]` (job code
 * reads its arguments from `process.argv.slice(2)`, as before), checks the
 * optional prerequisite (`[skip] <reason>`, exit 0), and runs the job
 * inside `runScript(crashLabel(job, jobId), ..., crashDir)` from `@karmaniverous/jeeves`:
 * a crash is appended to `_crash.log` in `crashDir` (default: the working
 * directory), logged, and exits 1, exactly as each module did when it
 * called `runScript` itself.
 */

import {
  type ArgSpec,
  parseRunnableArgs,
  runScript,
} from '@karmaniverous/jeeves';

import type { JobContext, JobModule } from './define-runnable.js';

/** Which job a run executes as (see {@link runJobModule}). */
export interface JobRunAs {
  /** The runner job id; default: the runnable id. */
  jobId?: string;
  /** The job's parsed config (`ctx.config`); default: `undefined`. */
  config?: unknown;
}

/**
 * The context a job runs with: its arguments, its declared flags parsed
 * from them (`{}` when it declares none), the job id it runs as and its
 * config.
 *
 * @throws Error `<name> requires a value` when a declared valued option has none.
 */
export const jobContext = (
  job: { id: string; flags?: ArgSpec | undefined },
  args: readonly string[],
  as: JobRunAs = {},
): JobContext => ({
  args: [...args],
  flags: job.flags ? parseRunnableArgs(args, job.flags) : {},
  jobId: as.jobId ?? job.id,
  config: as.config,
});

/** Seams for tests. */
export interface RunJobDeps {
  /** `runScript` from `@karmaniverous/jeeves`. */
  runScript: typeof runScript;
  /** Skip-line logger. */
  log: (line: string) => void;
}

const defaultDeps: RunJobDeps = {
  runScript,
  log: (line) => {
    console.log(line);
  },
};

/**
 * The crash label a run logs under (Decision 79): the job id when the
 * runnable has no `name`; its `name` for its own job; `<name> (<jobId>)`
 * for a job that runs it under another id, so two jobs of one runnable
 * never share a label.
 */
export const crashLabel = (job: JobModule, jobId: string): string => {
  if (job.name === undefined) return jobId;
  return jobId === job.id ? job.name : `${job.name} (${jobId})`;
};

/**
 * Run a job: set `process.argv`, check the prerequisite, run the body
 * inside `runScript`. Resolves when the body has finished (or the job was
 * skipped). A crash never resolves: `runScript` logs it and exits 1.
 *
 * @param as - The job the run executes as (`ctx.jobId`; default: the
 *   runnable id) and its parsed config (`ctx.config`). The job id is
 *   `process.argv[1]` and part of the crash label ({@link crashLabel}).
 */
export const runJobModule = (
  job: JobModule,
  args: readonly string[],
  deps: RunJobDeps = defaultDeps,
  as: JobRunAs = {},
): Promise<void> => {
  const jobId = as.jobId ?? job.id;
  process.argv = [process.argv[0] ?? process.execPath, jobId, ...args];
  const ctx = jobContext(job, args, { ...as, jobId });
  return new Promise<void>((resolve) => {
    deps.runScript(
      crashLabel(job, jobId),
      async () => {
        const ready = job.prerequisite ? await job.prerequisite(ctx) : true;
        if (ready === true) await job.run(ctx);
        else deps.log(`[skip] ${ready}`);
        resolve();
      },
      job.crashDir?.(),
    );
  });
};
