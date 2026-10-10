/**
 * @module x/lib/x-api
 *
 * Shared X API v2 client wrapping `@xdevplatform/xdk` with pipeline
 * conventions: handle and account-dir arguments, authenticated client
 * creation, the 401 refresh-and-retry wrapper and cached user lookup.
 * Credential files and token refresh are in `x-oauth`, timeline reads in
 * `x-timelines`, write actions in `x-actions`.
 *
 * If credentials are missing or lack an access_token the affected call is
 * skipped with a console warning.
 */

import { ApiError, Client } from '@xdevplatform/xdk';

import { constants } from '../../lib/constants.js';
import { readOAuthCredentials, refreshOAuth2Token } from './x-oauth.js';

// ── Handle resolution ──────────────────────────────────────────────

/**
 * Parse the X account handle from CLI args. Logs a skip message and
 * calls `process.exit(0)` if no handle is provided. When used at
 * module top level, the `never` return ensures TS narrows correctly.
 */
export function requireXHandle(scriptName: string): string {
  const handle = process.argv[2];
  if (!handle) {
    console.log(
      `[skip] No X account handle provided. Usage: jeeves-scripts run <job-id> <handle> (${scriptName})`,
    );
    process.exit(0);
  }
  return handle;
}

/**
 * Resolve the X account content directory from constants().X_ACCOUNTS. Logs a skip
 * message and calls `process.exit(0)` if the handle is not configured.
 */
export function requireAccountDir(handle: string): string {
  const dir = constants().X_ACCOUNTS[handle];
  if (!dir) {
    console.log(
      `[skip] X account '${handle}' not configured in constants().X_ACCOUNTS (constants.ts)`,
    );
    process.exit(0);
  }
  return dir;
}

// ── User-ID cache ──────────────────────────────────────────────────

const userIdCache = new Map<string, string>();

// ── Client factory ─────────────────────────────────────────────────

/**
 * Create an X API client for the given handle.
 *
 * Reads OAuth2 credentials from the server-managed JSON file at
 * `{constants().X_OAUTH_DIR}/x-{handle}-oauth2.json`.
 */
export function createXClient(handle: string): Client | null {
  const creds = readOAuthCredentials(handle);
  if (!creds) {
    console.log(`[skip] X OAuth2 credentials not found for @${handle}`);
    return null;
  }
  if (!creds.access_token) {
    console.log(`[skip] No access_token in credentials for @${handle}`);
    return null;
  }

  return new Client({ accessToken: creds.access_token });
}

// ── Auto-refresh wrapper ────────────────────────────────────────────

/**
 * Execute an API call with automatic token refresh on 401.
 *
 * Creates a client, runs `fn`. If the call throws a 401 ApiError, refreshes
 * the OAuth2 token and retries once with a fresh client.
 */
export async function withAutoRefresh<T>(
  handle: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = createXClient(handle);
  if (!client) throw new Error(`No X credentials for @${handle}`);

  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.log(`x-api: 401 for @${handle}, refreshing token...`);
      const refreshed = await refreshOAuth2Token(handle);
      if (!refreshed) throw err;

      const newClient = new Client({ accessToken: refreshed.accessToken });
      return await fn(newClient);
    }
    throw err;
  }
}

// ── User lookup ────────────────────────────────────────────────────

/** Resolve a handle to a user ID, caching the result. */
export async function lookupUser(
  client: Client,
  handle: string,
): Promise<string | null> {
  const cached = userIdCache.get(handle);
  if (cached) return cached;

  const res = await client.users.getByUsername(handle);
  const id = res.data?.id;
  if (!id) {
    console.log(`x-api: could not resolve user @${handle}`);
    return null;
  }
  userIdCache.set(handle, id);
  return id;
}
