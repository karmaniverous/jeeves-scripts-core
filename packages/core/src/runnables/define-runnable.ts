/**
 * @module runnables/define-runnable
 *
 * `defineRunnable` (Decisions 4, 40, 49): declares a runnable (a job module)
 * without running it, and `runJobModule`, which runs one the way every
 * entry point used to run itself. Importing a job module has no side
 * effects; the CLI's `run`
 * resolves the id through the registry and calls {@link runJobModule}.
 *
 * Running a job sets `process.argv` to `[node, <id>, ...args]` (job code
 * reads its arguments from `process.argv.slice(2)`, as before), checks the
 * optional prerequisite (`[skip] <reason>`, exit 0), and runs the job
 * inside `runScript(name ?? id, ..., crashDir)` from `@karmaniverous/jeeves`:
 * a crash is appended to `_crash.log` in `crashDir` (default: the working
 * directory), logged, and exits 1, exactly as each module did when it
 * called `runScript` itself.
 */

import { runScript } from '@karmaniverous/jeeves';
import { z } from 'zod';

import {
  type ArgSpec,
  type ParsedArgs,
  parseRunnableArgs,
} from '../lib/args.js';

/** What a running job receives. */
export const jobContextSchema = z.object({
  /** The job's command-line arguments (also in `process.argv.slice(2)`). */
  args: z.array(z.string()).readonly(),
});

/** No declared flags. */
export type NoFlags = Record<string, never>;

/** What a running job receives. */
export interface JobContext<S extends ArgSpec = ArgSpec> {
  /** The job's command-line arguments (also in `process.argv.slice(2)`). */
  args: readonly string[];
  /** The declared flags, parsed (`defineRunnable({ flags })`); `{}` when none are declared. */
  flags: ParsedArgs<S>;
}

/** The job body. */
export type JobRun<S extends ArgSpec = ArgSpec> = (
  ctx: JobContext<S>,
) => void | Promise<void>;

/**
 * A prerequisite check: `true` when the job can run, else the reason it
 * can't (logged as `[skip] <reason>`; the run exits 0).
 */
export type JobPrerequisite<S extends ArgSpec = ArgSpec> = (
  ctx: JobContext<S>,
) => true | string | Promise<true | string>;

/** A Zod schema for a function-valued declaration field (internal). */
export const fn = <T>(what: string) =>
  z.custom<T>((v) => typeof v === 'function', {
    message: `${what} must be a function`,
  });

/** The id and domain rule: lowercase words separated by dashes (internal). */
export const slugSchema = (what: string) =>
  z
    .string()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      `${what}: lowercase words separated by dashes`,
    );

/**
 * A job declaration (Zod-validated by {@link defineRunnable}).
 */
export const jobDeclarationSchema = z
  .object({
    /**
     * Stable runnable id, the public contract (`jeeves-scripts run <id>`):
     * `domain-verb[-modifier][-object][-specifier]`, lowercase words
     * separated by dashes, starting with the domain and a dash (R44, R45).
     */
    id: slugSchema('job id'),
    /** Domain the runnable belongs to: its top-level source folder (`email`, `google-drive`, ...). */
    domain: slugSchema('domain'),
    /** One line for `list`; required when the runnable has no manifest. */
    description: z.string().min(1).optional(),
    /** Label used in crash logs (default: the id). Core jobs keep their pre-registry labels. */
    name: z.string().min(1).optional(),
    /** Directory for `_crash.log`, resolved when the job runs (default: the working directory). */
    crashDir: fn<() => string>('crashDir').optional(),
    /**
     * The flags and valued options the job accepts (`lib/args`). When set,
     * `run <id>` rejects any other option before the body runs, and the job
     * reads the parsed values from `ctx.flags`. When unset, the job accepts
     * no flags (any given are passed through with a deprecation warning).
     */
    flags: z
      .custom<ArgSpec>(
        (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
        { message: 'flags must be an object' },
      )
      .optional(),
    /** Usage text for accepted positional arguments, e.g. `<handle>`; unset = none accepted. */
    positionals: z.string().min(1).optional(),
    /** Checked before `run`; anything but `true` skips the run. */
    prerequisite: fn<JobPrerequisite>('prerequisite').optional(),
    /** The job body. */
    run: fn<JobRun>('run'),
  })
  .refine((d) => d.id.startsWith(`${d.domain}-`), {
    message: 'job id must start with its domain and a dash',
    path: ['id'],
  });

/** A job declaration; `S` is its flag spec, which types `ctx.flags`. */
export type JobDeclaration<S extends ArgSpec = NoFlags> = Omit<
  z.infer<typeof jobDeclarationSchema>,
  'flags' | 'prerequisite' | 'run'
> & {
  /** See {@link jobDeclarationSchema}. */
  flags?: S;
  /** Checked before `run`; anything but `true` skips the run. */
  prerequisite?: JobPrerequisite<S>;
  /** The job body. */
  run: JobRun<S>;
};

const JOB = Symbol.for('@karmaniverous/jeeves-scripts-core/job');

/**
 * What a caller passes to a declared job's `run` or `prerequisite`. `flags`
 * may be left out (as tests written before declared flags do): the job then
 * parses them from `args` with its own spec.
 */
export interface JobCallContext {
  /** The job's command-line arguments. */
  args: readonly string[];
  /** The parsed flags; default: parsed from `args`. */
  flags?: ParsedArgs<ArgSpec>;
}

/** A declared job, as `defineRunnable` returns it. */
export type JobModule = Readonly<
  Omit<z.infer<typeof jobDeclarationSchema>, 'prerequisite' | 'run'>
> & {
  /** Checked before `run`; anything but `true` skips the run. */
  readonly prerequisite?: (
    ctx: JobCallContext,
  ) => true | string | Promise<true | string>;
  /** The job body. */
  readonly run: (ctx: JobCallContext) => void | Promise<void>;
  /** Brand set by {@link defineRunnable}; see {@link isJobModule}. */
  readonly [JOB]: true;
};

/**
 * Declare a job. Validates the declaration and returns it frozen; nothing
 * runs until `jeeves-scripts run <id>` runs it.
 *
 * @example
 * ```ts
 * export default defineRunnable({
 *   id: 'acme-report',
 *   domain: 'acme',
 *   prerequisite: () => hasAcmeConfig() || 'no acme block in jeeves-scripts.json',
 *   flags: { live: argFlag('--live', 'Write changes (default: dry run)') },
 *   run: async ({ flags }) => { await report(flags.live); },
 * });
 * ```
 * @throws When the declaration is invalid (bad id, missing `run`, ...).
 */
export const defineRunnable = <S extends ArgSpec = NoFlags>(
  declaration: JobDeclaration<S>,
): JobModule => {
  const result = jobDeclarationSchema.safeParse(declaration);
  if (!result.success)
    throw new Error(
      `Invalid job declaration: ${z.prettifyError(result.error)}`,
    );
  // `run` and `prerequisite` receive `flags` parsed with this same spec
  // (the casts: a caller's `flags` were parsed with it, or are parsed here).
  const { prerequisite, run } = declaration as unknown as {
    prerequisite?: (ctx: JobContext) => true | string | Promise<true | string>;
    run: (ctx: JobContext) => void | Promise<void>;
  };
  const withFlags = (ctx: JobCallContext): JobContext => ({
    args: ctx.args,
    flags: ctx.flags ?? jobContext(declaration, ctx.args).flags,
  });
  return Object.freeze({
    ...(declaration as unknown as Omit<
      z.infer<typeof jobDeclarationSchema>,
      'prerequisite' | 'run'
    >),
    ...(prerequisite
      ? { prerequisite: (ctx: JobCallContext) => prerequisite(withFlags(ctx)) }
      : {}),
    run: (ctx: JobCallContext) => run(withFlags(ctx)),
    [JOB]: true as const,
  });
};

/** Whether a value is a runnable declared with {@link defineRunnable}. */
export const isJobModule = (value: unknown): value is JobModule =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<symbol, unknown>)[JOB] === true;

/**
 * The context a job runs with: its arguments, and its declared flags parsed
 * from them (`{}` when it declares none).
 *
 * @throws Error `<name> requires a value` when a declared valued option has none.
 */
export const jobContext = (
  job: { flags?: ArgSpec | undefined },
  args: readonly string[],
): JobContext => ({
  args: [...args],
  flags: job.flags ? parseRunnableArgs(args, job.flags) : {},
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
 * Run a job: set `process.argv`, check the prerequisite, run the body
 * inside `runScript`. Resolves when the body has finished (or the job was
 * skipped). A crash never resolves: `runScript` logs it and exits 1.
 */
export const runJobModule = (
  job: JobModule,
  args: readonly string[],
  deps: RunJobDeps = defaultDeps,
): Promise<void> => {
  process.argv = [process.argv[0] ?? process.execPath, job.id, ...args];
  const ctx = jobContext(job, args);
  return new Promise<void>((resolve) => {
    deps.runScript(
      job.name ?? job.id,
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
