/**
 * @module admin/lib/session-refresh-settings
 *
 * Session refresh's settings (spec 2.12, behaviour 1): the typed fields on
 * the job's own delta, `jobs."admin-refresh-sessions"` (`contextThreshold`,
 * `idleMinutes`, `excludedKeys`; validated by `jobDeltaSchema`), with the
 * defaults applied. The environment variables 0.2 read are retired: if one
 * is still set the run fails naming the field that replaces it, so an
 * instance's old tuning is never ignored silently.
 */

import type { JobDelta } from '../../config/jobs-schema.js';
import {
  SESSION_REFRESH_CONTEXT_THRESHOLD,
  SESSION_REFRESH_IDLE_MINUTES,
} from '../../lib/constants.js';
import type { RefreshSettings } from './session-refresh-select.js';

/** The retired environment variables and the delta fields that replace them. */
export const LEGACY_ENV: Readonly<Record<string, string>> = {
  CACHE_READ_THRESHOLD: 'contextThreshold',
  IDLE_MINUTES: 'idleMinutes',
  EXCLUDED_SESSION_KEYS: 'excludedKeys',
};

/**
 * The settings from the job's delta (absent: every default).
 *
 * @param delta - `jobs."admin-refresh-sessions"`, already schema-validated.
 * @param env - The job's environment.
 * @throws When a retired environment variable is set.
 */
export function refreshSettings(
  delta: JobDelta | undefined,
  env: Readonly<Record<string, string | undefined>>,
): RefreshSettings {
  const legacy = Object.keys(LEGACY_ENV).filter(
    (name) => env[name] !== undefined,
  );
  if (legacy.length)
    throw new Error(
      `admin-refresh-sessions no longer reads ${legacy.join(', ')}: move ${legacy
        .map(
          (name) =>
            `${name} to jobs.admin-refresh-sessions.${LEGACY_ENV[name]!}`,
        )
        .join(', ')} (and remove it from the job's env)`,
    );
  return {
    contextThreshold:
      delta?.contextThreshold ?? SESSION_REFRESH_CONTEXT_THRESHOLD,
    idleMinutes: delta?.idleMinutes ?? SESSION_REFRESH_IDLE_MINUTES,
    excludedKeys: new Set(delta?.excludedKeys ?? []),
  };
}
