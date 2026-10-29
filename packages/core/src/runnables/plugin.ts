/**
 * @module runnables/plugin
 *
 * The instance plugin (Decisions 6, 7, 27, 49, 50; design §3):
 * `definePlugin` declares what an instance adds to core (its runnables,
 * declared overrides of core runnables, and the schema of its own `local`
 * config block), `override` declares one override, and `localConfig`
 * returns the `local` block as the plugin's schema parsed it.
 *
 * Declarations are validated with Zod and returned frozen; nothing runs
 * when they are made. The CLI loads `{root}/jeeves-scripts.plugin.ts`,
 * checks it against core's registry (`jobs/runnables`) and, when the plugin
 * has a `configSchema`, parses `local` with it before any runnable runs.
 *
 * Brands use `Symbol.for` and the parsed `local` block lives on
 * `globalThis`: the plugin is loaded through tsx, so the core copy it
 * imports may be a different module instance from the CLI's.
 */

import { z } from 'zod';

import {
  fn,
  isJobModule,
  type JobModule,
  type JobPrerequisite,
  type JobRun,
  slugSchema,
} from './define-runnable.js';

/** An exact semver version (no range), e.g. `0.1.0` or `1.0.0-rc.1`. */
export const EXACT_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const OVERRIDE = Symbol.for('@karmaniverous/jeeves-scripts-core/override');
const PLUGIN = Symbol.for('@karmaniverous/jeeves-scripts-core/plugin');
const LOCAL = Symbol.for('@karmaniverous/jeeves-scripts-core/local-config');

/** An override declaration (Zod-validated by {@link override}). */
export const jobOverrideDeclarationSchema = z.strictObject({
  /** The core runnable id this replaces. */
  job: slugSchema('override job id'),
  /** The core issue it works around, e.g. `karmaniverous/jeeves-scripts-core#123`. */
  issue: z.string().min(1),
  /** The exact core version (semver, no range) it was written against (`doctor` reports drift). */
  writtenFor: z
    .string()
    .regex(
      EXACT_SEMVER,
      'must be an exact semver version (e.g. 0.1.0), the core version the override was written against',
    ),
  /** Checked before `run`; anything but `true` skips the run. */
  prerequisite: fn<JobPrerequisite>('prerequisite').optional(),
  /** The replacement body. */
  run: fn<JobRun>('run'),
});

/** An override declaration. */
export type JobOverrideDeclaration = z.infer<
  typeof jobOverrideDeclarationSchema
>;

/** A declared override, as {@link override} returns it. */
export type JobOverride = Readonly<JobOverrideDeclaration> & {
  /** Brand set by {@link override}; see {@link isJobOverride}. */
  readonly [OVERRIDE]: true;
};

/** Whether a value is an override declared with {@link override}. */
export const isJobOverride = (value: unknown): value is JobOverride =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<symbol, unknown>)[OVERRIDE] === true;

/**
 * Declare an override of a core runnable (R20). It runs instead of core's
 * runnable under core's id; `list` shows it with source `override`.
 *
 * @example
 * ```ts
 * export default override({
 *   job: 'email-poll',
 *   issue: 'karmaniverous/jeeves-scripts-core#123',
 *   writtenFor: '0.1.0',
 *   run: async ({ args }) => { await pollMyWay(args); },
 * });
 * ```
 * @throws When the declaration is invalid.
 */
export const override = (declaration: JobOverrideDeclaration): JobOverride => {
  const result = jobOverrideDeclarationSchema.safeParse(declaration);
  if (!result.success)
    throw new Error(
      `Invalid override declaration: ${z.prettifyError(result.error)}`,
    );
  return Object.freeze({ ...declaration, [OVERRIDE]: true as const });
};

/** A schema the plugin parses its `local` block with (any Zod 4 schema). */
export type LocalConfigSchema = Pick<z.ZodType, 'safeParse'>;

/** A plugin declaration (Zod-validated by {@link definePlugin}). */
export const pluginDeclarationSchema = z.strictObject({
  /** Instance runnables (`defineRunnable`); a core id or a core domain is an error. */
  jobs: z
    .array(
      z.custom<JobModule>(isJobModule, {
        message: 'jobs[] entries must come from defineRunnable',
      }),
    )
    .readonly()
    .optional(),
  /** Declared replacements of core runnables. */
  overrides: z
    .array(
      z.custom<JobOverride>(isJobOverride, {
        message: 'overrides[] entries must come from override',
      }),
    )
    .readonly()
    .optional(),
  /** Validates the instance's own `local` block in `jeeves-scripts.json`. */
  configSchema: z
    .custom<LocalConfigSchema>(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { safeParse?: unknown }).safeParse === 'function',
      { message: 'configSchema must be a Zod schema' },
    )
    .optional(),
});

/** A plugin declaration. */
export type PluginDeclaration = z.infer<typeof pluginDeclarationSchema>;

/** A declared plugin, as {@link definePlugin} returns it. */
export type Plugin = Readonly<PluginDeclaration> & {
  /** Brand set by {@link definePlugin}; see {@link isPlugin}. */
  readonly [PLUGIN]: true;
};

/** Whether a value is a plugin declared with {@link definePlugin}. */
export const isPlugin = (value: unknown): value is Plugin =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<symbol, unknown>)[PLUGIN] === true;

/**
 * Declare the instance plugin: the default export of
 * `{root}/jeeves-scripts.plugin.ts`. Checks against core (core ids, core
 * domains, override targets) happen when the CLI loads it.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@karmaniverous/jeeves-scripts-core';
 * import { z } from 'zod';
 *
 * import acmeReport from './src/acme/report.js';
 *
 * export default definePlugin({
 *   jobs: [acmeReport],
 *   configSchema: z.object({ reportChannel: z.string() }),
 * });
 * ```
 * @throws When the declaration is invalid (unknown field, an entry not
 *   made with `defineRunnable` or `override`, ...).
 */
export const definePlugin = (declaration: PluginDeclaration): Plugin => {
  const result = pluginDeclarationSchema.safeParse(declaration);
  if (!result.success)
    throw new Error(
      `Invalid plugin declaration: ${z.prettifyError(result.error)}`,
    );
  return Object.freeze({ ...declaration, [PLUGIN]: true as const });
};

interface LocalSlot {
  value: unknown;
}

const slot = globalThis as typeof globalThis & {
  [LOCAL]?: LocalSlot;
};

/**
 * Parse the `local` block with the plugin's `configSchema` and keep the
 * result for {@link localConfig}. Called by the CLI at plugin load.
 *
 * @param local - The raw `local` block (`undefined` when absent).
 * @param source - Where it came from, for the error message.
 * @throws When the block does not satisfy the schema.
 */
export const setLocalConfig = (
  schema: LocalConfigSchema,
  local: unknown,
  source: string,
): void => {
  const result = schema.safeParse(local);
  if (!result.success)
    throw new Error(
      `Invalid local block in ${source}: ${z.prettifyError(result.error)}`,
    );
  slot[LOCAL] = { value: result.data };
};

/** Forget the parsed `local` block (tests). */
export const resetLocalConfig = (): void => {
  slot[LOCAL] = undefined;
};

/**
 * The instance's `local` config block, as the plugin's `configSchema`
 * parsed it when the CLI loaded the plugin.
 *
 * @typeParam S - The plugin's `configSchema` type; the result is its
 *   output (`localConfig<typeof configSchema>()`).
 * @example
 * ```ts
 * import { localConfig } from '@karmaniverous/jeeves-scripts-core';
 *
 * import type { configSchema } from './local-config.js';
 *
 * const { reportChannel } = localConfig<typeof configSchema>();
 * ```
 * @throws When no plugin with a `configSchema` has been loaded.
 */
export const localConfig = <S extends z.ZodType>(): z.output<S> => {
  const parsed = slot[LOCAL];
  if (!parsed)
    throw new Error(
      'localConfig(): no local block was parsed. Declare configSchema in jeeves-scripts.plugin.ts, and run through the jeeves-scripts CLI.',
    );
  return parsed.value as z.output<S>;
};
