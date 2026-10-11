/**
 * @module lib/args
 *
 * The one argument parser for core runnables: a declarative spec of flags
 * (`--live`, present or not) and valued options (`--project ACME`, the
 * argument after the name, else a default), read from `ctx.args`. Unknown
 * arguments are ignored, as every runnable has always done. Pure.
 */

/** A boolean flag: `true` when the name appears anywhere in the args. */
export interface FlagSpec {
  kind: 'flag';
  name: string;
}

/** A valued option: the argument after the name, else the default. */
export interface ValueSpec {
  kind: 'value';
  name: string;
  fallback: string;
}

/** A runnable's argument spec. */
export type ArgSpec = Record<string, FlagSpec | ValueSpec>;

/** The parsed arguments for a spec. */
export type ParsedArgs<S extends ArgSpec> = {
  [K in keyof S]: S[K] extends FlagSpec ? boolean : string;
};

/** Declare a flag. */
export const flag = (name: string): FlagSpec => ({ kind: 'flag', name });

/** Declare a valued option with its default. */
export const value = (name: string, fallback = ''): ValueSpec => ({
  kind: 'value',
  name,
  fallback,
});

/** The argument after `name`, else `fallback`. */
const valueOf = (
  args: readonly string[],
  name: string,
  fallback: string,
): string => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? fallback) : fallback;
};

/** Parse `args` against `spec`. */
export function parseRunnableArgs<S extends ArgSpec>(
  args: readonly string[],
  spec: S,
): ParsedArgs<S> {
  const out: Record<string, boolean | string> = {};
  for (const [key, s] of Object.entries(spec))
    out[key] =
      s.kind === 'flag'
        ? args.includes(s.name)
        : valueOf(args, s.name, s.fallback);
  return out as ParsedArgs<S>;
}
