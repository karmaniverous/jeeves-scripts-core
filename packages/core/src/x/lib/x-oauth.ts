/**
 * @module x/lib/x-oauth
 *
 * X OAuth2 credential files and token refresh. Credentials live in
 * `{constants().X_OAUTH_DIR}/x-{handle}-oauth2.json` (server-managed);
 * `refreshOAuth2Token` exchanges the refresh token and writes the new
 * tokens back to the same file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { OAuth2 } from '@xdevplatform/xdk';

import { constants } from '../../lib/constants.js';

// ── OAuth JSON helpers ─────────────────────────────────────────────

export interface XOAuthCredentials {
  provider: string;
  account: string;
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  obtained_at?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

/**
 * Resolve the path to the OAuth2 JSON credential file for a handle.
 * Format: `{constants().X_OAUTH_DIR}/x-{handle}-oauth2.json`
 */
export function getOAuthPath(handle: string): string {
  return path.join(constants().X_OAUTH_DIR, `x-${handle}-oauth2.json`);
}

/**
 * Read OAuth2 credentials from the server-managed JSON file.
 */
export function readOAuthCredentials(handle: string): XOAuthCredentials | null {
  const filePath = getOAuthPath(handle);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as XOAuthCredentials;
  } catch {
    console.log(`x-api: failed to parse ${filePath}`);
    return null;
  }
}

/**
 * Write OAuth2 credentials back to the server-managed JSON file.
 */
export function writeOAuthCredentials(
  handle: string,
  creds: XOAuthCredentials,
): void {
  const filePath = getOAuthPath(handle);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2) + '\n', 'utf8');
}

// ── Token refresh ──────────────────────────────────────────────────

export interface TokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
}

/**
 * Refresh OAuth2 token for a handle using credentials from the JSON file.
 * Reads client ID/secret and refresh token from the same file,
 * refreshes via the X API, and writes the updated tokens back.
 */
export async function refreshOAuth2Token(
  handle: string,
): Promise<TokenRefreshResult | null> {
  const creds = readOAuthCredentials(handle);
  if (!creds) {
    console.log(`[skip] OAuth2 credentials not found for @${handle}`);
    return null;
  }

  const { refresh_token: rt, clientId, clientSecret } = creds;
  if (!rt || !clientId || !clientSecret) {
    console.log(
      `[skip] Missing refresh token or client credentials for @${handle}`,
    );
    return null;
  }

  const oauth2 = new OAuth2({
    clientId,
    clientSecret,
    redirectUri: 'https://localhost',
  });

  const tokens = await oauth2.refreshToken(rt);

  // Write updated tokens back to the JSON file.
  const updated: XOAuthCredentials = {
    ...creds,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? rt,
    token_type: tokens.token_type,
    scope: tokens.scope,
    expires_in: tokens.expires_in,
    obtained_at: new Date().toISOString(),
  };
  writeOAuthCredentials(handle, updated);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? rt,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresIn: tokens.expires_in,
  };
}
