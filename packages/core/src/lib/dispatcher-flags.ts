/**
 * @module lib/dispatcher-flags
 *
 * The flags every dispatcher accepts (`--print-task`, `--dry-run`), for
 * `defineJob({ flags: dispatcherFlags })`, and their resolution for the
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

/**
 * The dispatcher flags from parsed flags or raw arguments (default:
 * `process.argv`).
 */
export const resolveDispatcherFlags = (
  input: readonly string[] | Partial<DispatcherFlags> = process.argv,
): DispatcherFlags =>
  isArgs(input)
    ? {
        printTask: input.includes('--print-task'),
        dryRun: input.includes('--dry-run'),
      }
    : { printTask: input.printTask ?? false, dryRun: input.dryRun ?? false };

/**
 * The declared dispatcher flags in a job context, or `undefined` when the
 * job declares none (then its raw arguments decide).
 */
export const declaredDispatcherFlags = (
  flags: object | undefined,
): Partial<DispatcherFlags> | undefined =>
  flags && ('printTask' in flags || 'dryRun' in flags)
    ? (flags as Partial<DispatcherFlags>)
    : undefined;
