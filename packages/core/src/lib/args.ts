/**
 * @module lib/args
 *
 * The one argument parser for runnables, core's and instances' (root
 * export): a typed spec of bare boolean flags, valued options
 * (`--name value` or `--name=value`, optionally a short alias) and
 * positionals. A runnable declares its spec as `defineJob({ flags })`; the
 * CLI checks the arguments against it ({@link unknownArgs}) and the job
 * reads the parsed values from `ctx.flags`. Pure.
 */

/** A bare boolean flag: `true` when the exact name appears in the args. */
export interface FlagSpec {
  /** Discriminant. */
  kind: 'flag';
  /** The flag as typed, e.g. `--live`. */
  name: string;
  /** One line for `run <id> --help`. */
  description?: string;
}

/** How a valued option may also be written. */
export interface ArgValueOptions {
  /** A short alias taking its value as the next argument, e.g. `-e`. */
  alias?: string;
  /** One line for `run <id> --help`. */
  description?: string;
}

/** A valued option: its value, else the default. */
export interface ValueSpec extends ArgValueOptions {
  /** Discriminant. */
  kind: 'value';
  /** The option as typed, e.g. `--project`. */
  name: string;
  /** The value when the option is absent. */
  fallback: string;
}

/** An optional valued option: its value, else `undefined`. */
export interface OptionalSpec extends ArgValueOptions {
  /** Discriminant. */
  kind: 'optional';
  /** The option as typed, e.g. `--days`. */
  name: string;
}

/** A runnable's argument spec: result key to flag or option. */
export type ArgSpec = Record<string, FlagSpec | ValueSpec | OptionalSpec>;

/** The parsed arguments for a spec. */
export type ParsedArgs<S extends ArgSpec> = {
  [K in keyof S]: S[K] extends FlagSpec
    ? boolean
    : S[K] extends OptionalSpec
      ? string | undefined
      : string;
};

/** Declare a bare boolean flag (`--live`). `--live=true` does not set it. */
export const argFlag = (name: string, description?: string): FlagSpec => ({
  kind: 'flag',
  name,
  ...(description === undefined ? {} : { description }),
});

/** Declare a valued option with its default (`''` unless given). */
export const argValue = (
  name: string,
  fallback = '',
  options: ArgValueOptions = {},
): ValueSpec => ({ kind: 'value', name, fallback, ...options });

/** Declare an optional valued option (no default). */
export const argOptional = (
  name: string,
  options: ArgValueOptions = {},
): OptionalSpec => ({ kind: 'optional', name, ...options });

/**
 * The value of the first occurrence of a valued option, or `undefined`
 * when absent.
 *
 * @throws Error `<name> requires a value` when that occurrence has none:
 *   the end of the args, an empty `--name=`, or a next argument starting
 *   with `-`.
 */
const valueOf = (
  args: readonly string[],
  { name, alias }: ValueSpec | OptionalSpec,
): string | undefined => {
  const inline = `${name}=`;
  const i = args.findIndex(
    (a) => a === name || a.startsWith(inline) || (!!alias && a === alias),
  );
  if (i < 0) return undefined;
  const arg = args[i] ?? '';
  const found = arg.startsWith(inline) ? arg.slice(inline.length) : args[i + 1];
  if (!found || found.startsWith('-'))
    throw new Error(`${name} requires a value`);
  return found;
};

/**
 * Parse `args` (a runnable's `ctx.args`) against `spec`.
 *
 * @example
 * ```ts
 * const { live, project, days } = parseRunnableArgs(ctx.args, {
 *   live: argFlag('--live'),
 *   project: argValue('--project', 'ACME'),
 *   days: argOptional('--days', { alias: '-d' }),
 * });
 * ```
 *
 * @throws Error `<name> requires a value` when a valued option is given
 *   without one.
 */
export function parseRunnableArgs<S extends ArgSpec>(
  args: readonly string[],
  spec: S,
): ParsedArgs<S> {
  const out: Record<string, boolean | string | undefined> = {};
  for (const [key, s] of Object.entries(spec))
    out[key] =
      s.kind === 'flag'
        ? args.includes(s.name)
        : s.kind === 'optional'
          ? valueOf(args, s)
          : (valueOf(args, s) ?? s.fallback);
  return out as ParsedArgs<S>;
}

/**
 * The arguments `spec` does not declare: an option-like argument (starting
 * with `-`) that is no flag, option or alias of `spec` (`--name=value` for
 * a valued option), and, unless `positionals` is set, any positional
 * argument. The separate value of a valued option is never reported.
 */
export function unknownArgs(
  args: readonly string[],
  spec: ArgSpec,
  positionals = false,
): string[] {
  const specs = Object.values(spec);
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? '';
    if (!a.startsWith('-')) {
      if (!positionals) unknown.push(a);
      continue;
    }
    const s = specs.find(
      (x) =>
        a === x.name ||
        (x.kind !== 'flag' && (a === x.alias || a.startsWith(`${x.name}=`))),
    );
    if (!s) unknown.push(a);
    else if (s.kind !== 'flag' && !a.includes('=')) i += 1;
  }
  return unknown;
}

/**
 * The positional arguments: every argument that does not start with `-`
 * and is not the separate value of one of `spec`'s valued options (by name
 * or alias). `--name=value` is a single argument, so it never hides one.
 */
export function positionalArgs(
  args: readonly string[],
  spec: ArgSpec = {},
): string[] {
  const valued = new Set<string>();
  for (const s of Object.values(spec))
    if (s.kind !== 'flag') {
      valued.add(s.name);
      if (s.alias) valued.add(s.alias);
    }
  return args.filter(
    (a, i) => !a.startsWith('-') && !valued.has(args[i - 1] ?? ''),
  );
}
