/**
 * @module runnables/define-runnable
 *
 * `defineRunnable` (Decisions 4, 40, 49, 79): declares a runnable (a job
 * module) without running it. Importing a job module has no side effects;
 * the CLI's `run` resolves the id through the registry and runs it with
 * `runJobModule` (`runnables/run-job`).
 */

import { type ArgSpec, type ParsedArgs } from '@karmaniverous/jeeves';
import { z } from 'zod';

import { jobContext } from './run-job.js';

/** What a running job receives. */
export const jobContextSchema = z.object({
  /** The job's command-line arguments (also in `process.argv.slice(2)`). */
  args: z.array(z.string()).readonly(),
  /** The runner job id the run executes as (Decision 79). */
  jobId: z.string().min(1),
  /** The job's config, parsed with the runnable's `configSchema` (Decision 81). */
  config: z.unknown(),
});

/** No declared flags. */
export type NoFlags = Record<string, never>;

/** A runnable's config schema: any Zod 4 schema (Decision 80). */
export type RunnableConfigSchema = z.ZodType;

/** `ctx.config` for a config schema: its output, or `undefined` without one. */
export type JobConfigOf<C extends RunnableConfigSchema | undefined> =
  C extends RunnableConfigSchema ? z.output<C> : undefined;

/**
 * What a running job receives. `S` is its flag spec, which types
 * `ctx.flags`; `C` its config schema, which types `ctx.config`.
 */
export interface JobContext<
  S extends ArgSpec = ArgSpec,
  C extends RunnableConfigSchema | undefined = RunnableConfigSchema | undefined,
> {
  /** The job's command-line arguments (also in `process.argv.slice(2)`). */
  args: readonly string[];
  /** The declared flags, parsed (`defineRunnable({ flags })`); `{}` when none are declared. */
  flags: ParsedArgs<S>;
  /**
   * The runner job id the run executes as (Decision 79): the runnable id
   * for an ordinary job, the manifest entry's id for a job that runs this
   * runnable under its own id. Key anything the run owns (state, worker
   * job ids) by it.
   */
  jobId: string;
  /**
   * The job's config (Decision 81): `jobs.<runnableId>.config` with
   * `jobs.<jobId>.config` merged over it, parsed with the runnable's
   * `configSchema`; `undefined` for a runnable without one.
   */
  config: JobConfigOf<C>;
}

/** The job body. */
export type JobRun<
  S extends ArgSpec = ArgSpec,
  C extends RunnableConfigSchema | undefined = RunnableConfigSchema | undefined,
> = (ctx: JobContext<S, C>) => void | Promise<void>;

/**
 * A prerequisite check: `true` when the job can run, else the reason it
 * can't (logged as `[skip] <reason>`; the run exits 0).
 */
export type JobPrerequisite<
  S extends ArgSpec = ArgSpec,
  C extends RunnableConfigSchema | undefined = RunnableConfigSchema | undefined,
> = (ctx: JobContext<S, C>) => true | string | Promise<true | string>;

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
 * A runnable declaration (Zod-validated by {@link defineRunnable}).
 */
export const jobDeclarationSchema = z
  .object({
    /**
     * Stable runnable id, the public contract (`jeeves-scripts run <id>`):
     * `domain-verb[-modifier][-object][-specifier]`, lowercase words
     * separated by dashes, starting with the domain and a dash (R44, R45).
     */
    id: slugSchema('runnable id'),
    /** Domain the runnable belongs to: its top-level source folder (`email`, `google-drive`, ...). */
    domain: slugSchema('domain'),
    /** One line for `list`; required when the runnable has no manifest. */
    description: z.string().min(1).optional(),
    /** Label used in crash logs (default: the id). Core jobs keep their pre-registry labels. */
    name: z.string().min(1).optional(),
    /** Directory for `_crash.log`, resolved when the job runs (default: the working directory). */
    crashDir: fn<() => string>('crashDir').optional(),
    /**
     * The flags and valued options the job accepts (the argument parser from `@karmaniverous/jeeves`). When set,
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
    /**
     * Validates the job's config (Decisions 80, 81), which the run reads
     * as `ctx.config`. Declaring one states that the runnable keys
     * everything it owns by `ctx.jobId` and reads its settings from
     * `ctx.config`, so a manifest entry may run it under another job id.
     */
    configSchema: z
      .custom<RunnableConfigSchema>(
        (v) =>
          typeof v === 'object' &&
          v !== null &&
          typeof (v as { safeParse?: unknown }).safeParse === 'function',
        { message: 'configSchema must be a Zod schema' },
      )
      .optional(),
    /** Checked before `run`; anything but `true` skips the run. */
    prerequisite: fn<JobPrerequisite>('prerequisite').optional(),
    /**
     * Checked by `doctor` only, once `prerequisite` is met: `true`, or why
     * a run would fail now (reported as not met). For a condition that
     * must fail the run rather than skip it: `run` throws on it itself.
     */
    doctorCheck: fn<JobPrerequisite>('doctorCheck').optional(),
    /** The job body. */
    run: fn<JobRun>('run'),
  })
  .refine((d) => d.id.startsWith(`${d.domain}-`), {
    message: 'runnable id must start with its domain and a dash',
    path: ['id'],
  });

/**
 * A runnable declaration; `S` is its flag spec, which types `ctx.flags`,
 * and `C` its config schema, which types `ctx.config`.
 */
export type JobDeclaration<
  S extends ArgSpec = NoFlags,
  C extends RunnableConfigSchema | undefined = undefined,
> = Omit<
  z.infer<typeof jobDeclarationSchema>,
  'flags' | 'configSchema' | 'prerequisite' | 'doctorCheck' | 'run'
> & {
  /** See {@link jobDeclarationSchema}. */
  flags?: S;
  /** See {@link jobDeclarationSchema}. */
  configSchema?: C;
  /** Checked before `run`; anything but `true` skips the run. */
  prerequisite?: JobPrerequisite<S, C>;
  /** Checked by `doctor` only, once `prerequisite` is met (see {@link jobDeclarationSchema}). */
  doctorCheck?: JobPrerequisite<S, C>;
  /** The job body. */
  run: JobRun<S, C>;
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
  /** The job id the run executes as; default: the runnable id. */
  jobId?: string;
  /** The job's parsed config (see {@link JobContext}); default: `undefined`. */
  config?: unknown;
}

/** A declared job, as `defineRunnable` returns it. */
export type JobModule = Readonly<
  Omit<
    z.infer<typeof jobDeclarationSchema>,
    'prerequisite' | 'doctorCheck' | 'run'
  >
> & {
  /** Checked before `run`; anything but `true` skips the run. */
  readonly prerequisite?: (
    ctx: JobCallContext,
  ) => true | string | Promise<true | string>;
  /** Checked by `doctor` only, once `prerequisite` is met. */
  readonly doctorCheck?: (
    ctx: JobCallContext,
  ) => true | string | Promise<true | string>;
  /** The job body. */
  readonly run: (ctx: JobCallContext) => void | Promise<void>;
  /** Brand set by {@link defineRunnable}; see {@link isJobModule}. */
  readonly [JOB]: true;
};

/**
 * Declare a runnable. Validates the declaration and returns it frozen; nothing
 * runs until `jeeves-scripts run <id>` runs it.
 *
 * @example
 * ```ts
 * export default defineRunnable({
 *   id: 'acme-report',
 *   domain: 'acme',
 *   prerequisite: () => hasAcmeConfig() || 'no acme block in the instance config',
 *   flags: { live: argFlag('--live', 'Write changes (default: dry run)') },
 *   configSchema: z.object({ channel: z.string() }),
 *   run: async ({ flags, config }) => { await report(flags.live, config.channel); },
 * });
 * ```
 * @throws When the declaration is invalid (bad id, missing `run`, ...).
 */
export const defineRunnable = <
  S extends ArgSpec = NoFlags,
  C extends RunnableConfigSchema | undefined = undefined,
>(
  declaration: JobDeclaration<S, C>,
): JobModule => {
  const result = jobDeclarationSchema.safeParse(declaration);
  if (!result.success)
    throw new Error(
      `Invalid runnable declaration: ${z.prettifyError(result.error)}`,
    );
  // `run` and `prerequisite` receive `flags` parsed with this same spec
  // (the casts: a caller's `flags` were parsed with it, or are parsed here).
  type Check = (ctx: JobContext) => true | string | Promise<true | string>;
  const { prerequisite, doctorCheck, run } = declaration as unknown as {
    prerequisite?: Check;
    doctorCheck?: Check;
    run: (ctx: JobContext) => void | Promise<void>;
  };
  const withFlags = (ctx: JobCallContext): JobContext => ({
    args: ctx.args,
    flags: ctx.flags ?? jobContext(declaration, ctx.args).flags,
    jobId: ctx.jobId ?? declaration.id,
    config: ctx.config,
  });
  return Object.freeze({
    ...(declaration as unknown as Omit<
      z.infer<typeof jobDeclarationSchema>,
      'prerequisite' | 'doctorCheck' | 'run'
    >),
    ...(prerequisite
      ? { prerequisite: (ctx: JobCallContext) => prerequisite(withFlags(ctx)) }
      : {}),
    ...(doctorCheck
      ? { doctorCheck: (ctx: JobCallContext) => doctorCheck(withFlags(ctx)) }
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
