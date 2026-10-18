/**
 * @module jobs/job-help
 *
 * What `run <id>` checks and prints about a runnable's arguments (#14):
 *
 * - {@link argsError}: a runnable that declares `flags` accepts only those
 *   (and positionals only when it declares `positionals`); anything else
 *   fails the run before its body starts.
 * - {@link flagsDeprecation}: a runnable that declares no `flags` still
 *   receives whatever it is given, with a warning. A later minor release
 *   makes this strict for every runnable.
 * - {@link formatJobHelp}: the `run <id> --help` text.
 *
 * Pure.
 */

import { type ArgSpec, unknownArgs, valuelessArgs } from '../lib/args.js';
import type { JobModule } from './define-job.js';
import type { JobManifest } from './manifest.js';

/** True when `args` asks for help (`--help` or `-h`). */
export const wantsHelp = (args: readonly string[]): boolean =>
  args.includes('--help') || args.includes('-h');

/**
 * Why `args` cannot run `job`, or `undefined` when they can. Only checked
 * for a runnable that declares `flags`.
 */
export const argsError = (
  job: Pick<JobModule, 'id' | 'flags' | 'positionals'>,
  args: readonly string[],
): string | undefined => {
  if (!job.flags) return undefined;
  const see = `(see run ${job.id} --help)`;
  const [bad] = unknownArgs(args, job.flags, job.positionals !== undefined);
  if (bad !== undefined)
    return bad.startsWith('-')
      ? `Unknown option ${bad} for ${job.id} ${see}`
      : `Unexpected argument ${bad} for ${job.id} ${see}`;
  const [valueless] = valuelessArgs(args, job.flags);
  if (valueless !== undefined)
    return `${valueless} requires a value for ${job.id} ${see}`;
  return undefined;
};

/**
 * The deprecation warning for flags given to a runnable that declares
 * none, or `undefined`.
 */
export const flagsDeprecation = (
  job: Pick<JobModule, 'id' | 'flags'>,
  args: readonly string[],
): string | undefined =>
  !job.flags && args.some((a) => a.startsWith('-'))
    ? `[deprecated] ${job.id} declares no flags; undeclared flags will be rejected in a later release (see run ${job.id} --help)`
    : undefined;

const describeSpec = (spec: ArgSpec): string[] =>
  Object.values(spec).map((s) => {
    const names =
      s.kind !== 'flag' && s.alias ? `${s.alias}, ${s.name}` : s.name;
    const usage = s.kind === 'flag' ? names : `${names} <value>`;
    const notes = [
      s.description,
      s.kind === 'value' ? `default: ${s.fallback}` : undefined,
    ].filter((n): n is string => n !== undefined && n !== '');
    return `  ${usage}${notes.length > 0 ? `  ${notes.join('; ')}` : ''}`;
  });

/**
 * The `run <id> --help` text: usage, description, declared flags and the
 * effective manifest (`undefined`: the runnable has none).
 */
export const formatJobHelp = (
  job: Pick<JobModule, 'id' | 'description' | 'name' | 'flags' | 'positionals'>,
  manifest: JobManifest | undefined,
): string => {
  const usage = [
    `Usage: jeeves-scripts run ${job.id}`,
    job.flags && Object.keys(job.flags).length > 0 ? '[options]' : undefined,
    job.positionals,
  ]
    .filter((p) => p !== undefined)
    .join(' ');
  const lines = [usage, ''];
  const description = job.description ?? job.name;
  if (description) lines.push(description, '');
  lines.push('Options:');
  if (job.flags) lines.push(...describeSpec(job.flags));
  else lines.push('  (no flags declared)');
  lines.push('  -h, --help  Print this help and exit', '');
  lines.push(
    'Manifest:',
    manifest ? JSON.stringify(manifest, null, 2) : '  (none: not scheduled)',
  );
  return lines.join('\n');
};
