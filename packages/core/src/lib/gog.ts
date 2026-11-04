/**
 * @module gog
 *
 * Google Workspace CLI wrapper: retry-aware invocation of the gog binary
 * for Gmail and Calendar operations.
 *
 * Called by email/poll.ts, email/download.ts and meetings/lib/doc-fetch.ts.
 * On first use, defaults `GOG_HOME` to `GOG_CONFIG_DIR` so gog (and every
 * child process it spawns) reads the same home the scripts read: the
 * directory jeeves-tools provisions. An explicit `GOG_HOME` (set by the
 * gateway unit and the runner drop-in on managed instances) is left
 * untouched. Config is read when gog is first run, never at import.
 *
 * Config dependencies: `integrations.gog.bin` and `paths.gogHome` (`GOG_HOME`
 * wins) in the instance config, through constants().
 */

import { runWithRetry } from '@karmaniverous/jeeves';

import { constants } from './constants.js';

/** The gog binary, after defaulting `GOG_HOME` (see the module notes). */
export function gogBin(): string {
  const c = constants();
  process.env.GOG_HOME ??= c.GOG_CONFIG_DIR;
  return c.GOG_BIN;
}

/** A gog runner: arguments and retry options in, stdout out. */
export type GogRunner = (
  args: string[],
  opts?: { retries?: number; backoffMs?: number },
) => string;

/**
 * Whether a gog error is an auth failure that only a person can fix by
 * re-authorizing (`gog auth add`): an expired or revoked refresh token
 * (`invalid_grant`). Never worth a retry (#66).
 */
const isGogAuthError = (msg: string): boolean =>
  /invalid_grant|expired or revoked|run 'gog auth add'/i.test(msg);

/**
 * Whether a gog error is worth retrying: a transient timeout, unless it is
 * also an auth failure ({@link isGogAuthError}), which fails fast.
 */
const isGogRetryable = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  if (isGogAuthError(msg)) return false;
  return /context deadline exceeded|timed out|timeout/i.test(msg);
};

/**
 * Run a gog command with retry logic for transient network errors; auth
 * failures are never retried.
 */
export const gogWithRetry: GogRunner = (args, opts = {}) =>
  runWithRetry(gogBin(), args, {
    retries: opts.retries ?? 2,
    backoffMs: opts.backoffMs ?? 5000,
    isRetryable: isGogRetryable,
  });
