/**
 * @module lib/dispatcher-flags
 *
 * The flags every dispatcher accepts (`--print-task`, `--dry-run`), for
 * `defineRunnable({ flags: dispatcherFlags })`, and their resolution for the
 * dispatch helpers.
 *
 * A dispatcher that declares them passes the parsed `ctx.flags`. One that
 * does not (the compatibility path for instance runnables written before
 * declared flags) passes its raw arguments, or nothing, in which case
 * `process.argv` is read as before. Pure apart from that default.
 */

import { argFlag, type ParsedArgs } from './args.js';

/** The flags every dispatcher accepts. */
export const dispatcherFlags = {
  printTask: argFlag('--print-task', 'Print the full TASK; dispatch nothing'),
  dryRun: argFlag(
    '--dry-run',
    'Report what would be dispatched (job, task length, post targets); dispatch nothing',
  ),
};

/** Parsed {@link dispatcherFlags}. */
export type DispatcherFlags = ParsedArgs<typeof dispatcherFlags>;

const isArgs = (
  input: readonly string[] | Partial<DispatcherFlags>,
): input is readonly string[] => Array.isArray(input);

/** A dispatcher flag value: a boolean, or absent (`false`). */
function flagValue(flags: object, key: keyof DispatcherFlags): boolean {
  const value: unknown = (flags as Record<string, unknown>)[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean')
    throw new TypeError(
      `dispatcher flag ${key} must be a boolean, got ${typeof value}`,
    );
  return value;
}

/**
 * The dispatcher flags from parsed flags or raw arguments (default:
 * `process.argv`).
 *
 * @throws TypeError when a parsed flag is present but not a boolean.
 */
export const resolveDispatcherFlags = (
  input: readonly string[] | Partial<DispatcherFlags> = process.argv,
): DispatcherFlags =>
  isArgs(input)
    ? {
        printTask: input.includes('--print-task'),
        dryRun: input.includes('--dry-run'),
      }
    : {
        printTask: flagValue(input, 'printTask'),
        dryRun: flagValue(input, 'dryRun'),
      };

/**
 * The declared dispatcher flags in a job context (validated booleans), or
 * `undefined` when the job declares none (then its raw arguments decide).
 *
 * @throws TypeError when a declared flag is not a boolean.
 */
export const declaredDispatcherFlags = (
  flags: object | undefined,
): DispatcherFlags | undefined =>
  flags && ('printTask' in flags || 'dryRun' in flags)
    ? {
        printTask: flagValue(flags, 'printTask'),
        dryRun: flagValue(flags, 'dryRun'),
      }
    : undefined;
