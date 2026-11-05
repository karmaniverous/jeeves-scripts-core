/**
 * @module gh
 *
 * GitHub CLI wrappers — typed invocation of the gh binary with
 * structured result parsing.
 *
 * Called by github/ domain scripts (sync-repos, sync-issues, registry)
 * and admin scripts. Sets constants().GH_CONFIG_DIR from constants so gh finds
 * the correct auth tokens regardless of working directory.
 *
 * Config dependencies: `integrations.gh.bin` and `integrations.gh.configDir`
 * (`GH_CONFIG_DIR` wins) in the instance config, through constants().
 */

import cp from 'node:child_process';

import { run } from '@karmaniverous/jeeves';

import { constants } from './constants.js';

export { run };

/**
 * Set up GitHub CLI config directory. Call before any `gh` operations.
 */
export function setupGhConfig(): void {
  process.env.GH_CONFIG_DIR = constants().GH_CONFIG_DIR;
}

/** The outcome of one `gh` invocation. */
export interface GhResult {
  /** Whether `gh` exited 0. */
  ok: boolean;
  /** Exit status (`null` when the process was killed or failed to start). */
  status: number | null;
  /** Trimmed stdout. */
  out: string;
  /** Trimmed stderr. */
  err: string;
  /** Spawn error message, when `gh` could not be started. */
  error?: string;
}

/** Options for {@link gh}. */
export interface GhOptions {
  /** Return a failed {@link GhResult} instead of throwing. */
  allowFail?: boolean;
  /** @deprecated Unused; parse with {@link ghJson}. */
  json?: boolean;
  /**
   * Kill `gh` after this many milliseconds, so a hung call can't hang the
   * job. Default: no limit.
   */
  timeoutMs?: number;
}

/** Options for {@link ghJson} and {@link ghApi}. */
export type GhJsonOptions = Pick<GhOptions, 'timeoutMs'>;

/**
 * Run a gh CLI command and return structured result.
 *
 * @throws Error on a non-zero exit, a spawn failure, or (with `timeoutMs`)
 *   `gh <args> timed out after <n>ms`, unless `allowFail`.
 */
export function gh(args: string[], options: GhOptions = {}): GhResult {
  const r = cp.spawnSync(constants().GH_BIN, args, {
    encoding: 'utf8',
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();

  if (r.error) {
    const timedOut =
      options.timeoutMs !== undefined &&
      (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    const error = timedOut
      ? new Error(
          `gh ${args.join(' ')} timed out after ${String(options.timeoutMs)}ms`,
        )
      : r.error;
    if (options.allowFail)
      return {
        ok: false,
        status: null,
        out,
        err,
        error: timedOut ? error.message : String(r.error),
      };
    throw error;
  }
  if (r.status !== 0) {
    if (options.allowFail) return { ok: false, status: r.status, out, err };
    throw new Error(`gh ${args.join(' ')} failed: ${(err || out).trim()}`);
  }

  return { ok: true, status: 0, out, err };
}

/**
 * Run a gh CLI command and parse stdout as JSON.
 *
 * @param options - `timeoutMs`, as for {@link gh}.
 */
export function ghJson(args: string[], options: GhJsonOptions = {}): unknown {
  const result = gh(args, options);
  return result.out ? (JSON.parse(result.out) as unknown) : null;
}

/**
 * Call the GitHub REST API via gh cli.
 *
 * @param options - `timeoutMs`, as for {@link gh}.
 */
export function ghApi(endpoint: string, options: GhJsonOptions = {}): unknown {
  return ghJson(['api', endpoint], options);
}
