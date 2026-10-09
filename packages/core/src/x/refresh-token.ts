#!/usr/bin/env tsx
/**
 * @module refresh-token
 *
 * Refreshes the X OAuth 2.0 access token for an account.
 *
 * Entry-point script invoked manually or by the runner scheduler. Calls
 * refreshOAuth2Token from x-api, which reads client credentials and the
 * refresh token from the OAuth JSON file and writes updated tokens back.
 *
 * NOTE: The scheduled runner job for this script can be retired now that
 * pollers and queue-action scripts auto-refresh on 401 via withAutoRefresh.
 * This script remains useful for manual/diagnostic token refresh.
 */

import { runScript } from '@karmaniverous/jeeves';

import {
  getOAuthPath,
  refreshOAuth2Token,
  requireXHandle,
} from './lib/x-api.js';

const handle = requireXHandle('refresh-token.ts');

async function main(): Promise<void> {
  console.log(`Refreshing X OAuth 2.0 token for @${handle}...`);
  const result = await refreshOAuth2Token(handle);
  if (!result) return;

  console.log(
    `Token refreshed for @${handle}. Expires in:`,
    result.expiresIn,
    'seconds',
  );
  console.log(`Written to: ${getOAuthPath(handle)}`);
}

runScript('x/refresh-token', () => {
  main().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
});
