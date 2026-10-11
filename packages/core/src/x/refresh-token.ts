/**
 * @module x/refresh-token
 *
 * Refreshes the X OAuth 2.0 access token for one account and writes the
 * new tokens back to its credential file (`x-oauth`).
 *
 * Usage: `jeeves-scripts run x-refresh-token <handle>`. The prerequisite
 * skips (exit 0) without a handle; a missing credential file is reported
 * by the refresh as a skip.
 *
 * NOTE: The scheduled runner job for this script can be retired now that
 * pollers and queue-action scripts auto-refresh on 401 via withAutoRefresh.
 * This script remains useful for manual/diagnostic token refresh.
 */

import { defineJob } from '../jobs/define-job.js';
import { xHandlePrerequisite } from './lib/x-api.js';
import { xConfig, type XJobDeps, xJobDeps } from './lib/x-deps.js';
import { getOAuthPath } from './lib/x-oauth.js';

/** Refresh the handle's token and report where it was written. */
export async function refreshXToken(
  handle: string,
  deps: Pick<XJobDeps, 'refresh' | 'oauthDir'>,
): Promise<void> {
  console.log(`Refreshing X OAuth 2.0 token for @${handle}...`);
  const result = await deps.refresh(handle);
  if (!result) return;
  console.log(
    `Token refreshed for @${handle}. Expires in:`,
    result.expiresIn,
    'seconds',
  );
  console.log(`Written to: ${getOAuthPath(deps.oauthDir, handle)}`);
}

export default defineJob({
  id: 'x-refresh-token',
  domain: 'x',
  description:
    "Refresh an X account's OAuth 2.0 access token (manual or diagnostic; pollers refresh on 401).",
  name: 'x/refresh-token',
  prerequisite: xHandlePrerequisite({
    scriptName: 'refresh-token.ts',
    requireOAuth: false,
    ...xConfig,
  }),
  run: ({ args }) => refreshXToken(args[0] ?? '', xJobDeps()),
});
