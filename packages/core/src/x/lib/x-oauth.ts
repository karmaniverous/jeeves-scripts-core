/**
 * @module x/lib/x-oauth
 *
 * X OAuth2 credential files and token refresh. Credentials live in
 * `{oauthDir}/x-{handle}-oauth2.json` (server-managed; `oauthDir` is
 * `integrations.x.oauthDir`); `refreshOAuth2Token` exchanges the refresh
 * token and writes the new tokens back to the same file.
 */

import fs from 'node:fs';
import path from 'node:path';

import { OAuth2 } from '@xdevplatform/xdk';

/** The server-managed credential file. */
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

/** The credential file for a handle: `{oauthDir}/x-{handle}-oauth2.json`. */
export function getOAuthPath(oauthDir: string, handle: string): string {
  return path.join(oauthDir, `x-${handle}-oauth2.json`);
}

/** Read a handle's credentials; `null` when absent or unparseable (logged). */
export function readOAuthCredentials(
  oauthDir: string,
  handle: string,
): XOAuthCredentials | null {
  const filePath = getOAuthPath(oauthDir, handle);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as XOAuthCredentials;
  } catch {
    console.log(`x-api: failed to parse ${filePath}`);
    return null;
  }
}

/** Write a handle's credentials back. */
export function writeOAuthCredentials(
  oauthDir: string,
  handle: string,
  creds: XOAuthCredentials,
): void {
  const filePath = getOAuthPath(oauthDir, handle);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2) + '\n', 'utf8');
}

/** New tokens. */
export interface TokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  scope?: string;
  expiresIn?: number;
}

/** The token endpoint's answer. */
export interface RefreshedTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

/** Exchanges a refresh token with the client credentials. */
export type TokenRefresher = (
  client: { clientId: string; clientSecret: string },
  refreshToken: string,
) => Promise<RefreshedTokens>;

/** The X SDK's OAuth2 refresh. */
export const xdkRefresher: TokenRefresher = (client, refreshToken) =>
  new OAuth2({ ...client, redirectUri: 'https://localhost' }).refreshToken(
    refreshToken,
  );

/**
 * Refresh a handle's token from its credential file and write the new
 * tokens back. `null` (logged as a skip) when the file or the refresh
 * token or client credentials are missing.
 */
export async function refreshOAuth2Token(
  oauthDir: string,
  handle: string,
  refresher: TokenRefresher = xdkRefresher,
  now: () => Date = () => new Date(),
): Promise<TokenRefreshResult | null> {
  const creds = readOAuthCredentials(oauthDir, handle);
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

  const tokens = await refresher({ clientId, clientSecret }, rt);
  const refreshToken = tokens.refresh_token ?? rt;
  writeOAuthCredentials(oauthDir, handle, {
    ...creds,
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    token_type: tokens.token_type,
    scope: tokens.scope,
    expires_in: tokens.expires_in,
    obtained_at: now().toISOString(),
  });
  return {
    accessToken: tokens.access_token,
    refreshToken,
    tokenType: tokens.token_type,
    scope: tokens.scope,
    expiresIn: tokens.expires_in,
  };
}
