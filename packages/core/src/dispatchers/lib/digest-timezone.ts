/**
 * @module dispatchers/lib/digest-timezone
 *
 * The time zone the daily digest dates itself in: the `pipeline.refs` entry
 * `digest.timezone` (an IANA zone such as `America/Chicago`, or `UTC`).
 * Required, no default: a missing or invalid value fails the run.
 */

import { tryGetRef } from '../../config/index.js';
import { requireTimeZone } from '../../lib/dates.js';

/** `pipeline.refs` key holding the digest's time zone. */
export const DIGEST_TIMEZONE_REF = 'digest.timezone';

/**
 * Read and validate `refs["digest.timezone"]`.
 *
 * @throws When the ref is missing (or the config has no `pipeline` block) or not a
 *   valid time zone.
 */
export function digestTimeZone(): string {
  return requireTimeZone(
    tryGetRef(DIGEST_TIMEZONE_REF),
    `pipeline.refs["${DIGEST_TIMEZONE_REF}"] in jeeves-scripts.json`,
  );
}
