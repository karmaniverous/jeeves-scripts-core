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
 * Config dependencies: constants().GH_BIN, constants().GH_CONFIG_DIR from constants.ts.
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

export interface GhResult {
  ok: boolean;
  status: number | null;
  out: string;
  err: string;
  error?: string;
}

/**
 * Run a gh CLI command and return structured result.
 */
export function gh(
  args: string[],
  options: { allowFail?: boolean; json?: boolean } = {},
): GhResult {
  const r = cp.spawnSync(constants().GH_BIN, args, { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();

  if (r.error) {
    if (options.allowFail)
      return { ok: false, status: null, out, err, error: String(r.error) };
    throw r.error;
  }
  if (r.status !== 0) {
    if (options.allowFail) return { ok: false, status: r.status, out, err };
    throw new Error(`gh ${args.join(' ')} failed: ${(err || out).trim()}`);
  }

  return { ok: true, status: 0, out, err };
}

/**
 * Run a gh CLI command and parse stdout as JSON.
 */
export function ghJson(args: string[]): unknown {
  const result = gh(args);
  return result.out ? (JSON.parse(result.out) as unknown) : null;
}

/**
 * Call the GitHub REST API via gh cli.
 */
export function ghApi(endpoint: string): unknown {
  return ghJson(['api', endpoint]);
}
