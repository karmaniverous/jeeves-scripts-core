/**
 * @module x/lib/x-api
 *
 * Shared X API v2 client wrapping `@xdevplatform/xdk` with pipeline
 * conventions: the handle prerequisite, authenticated client creation,
 * the 401 refresh-and-retry wrapper and cached user lookup. Credential
 * files and token refresh are in `x-oauth`, timeline reads in
 * `x-timelines`, write actions in `x-actions`.
 */

import fs from 'node:fs';

import { ApiError, Client } from '@xdevplatform/xdk';

import type { JobContext } from '../../runnables/define-runnable.js';
import type { XClient, XUserLookupClient } from './x-client.js';
import {
  getOAuthPath,
  readOAuthCredentials,
  refreshOAuth2Token,
  type TokenRefreshResult,
} from './x-oauth.js';

/** What the handle prerequisite checks. */
export interface XHandleCheck {
  /** Usage label (the script name). */
  scriptName: string;
  /** `integrations.x.accounts` (handle to content directory). */
  accounts: () => Readonly<Record<string, string>>;
  /** `integrations.x.oauthDir`. */
  oauthDir: () => string;
  /** Also require the handle in `accounts` (default: no). */
  requireAccount?: boolean;
  /** Also require the OAuth2 credential file (default: yes). */
  requireOAuth?: boolean;
}

/**
 * The prerequisite of the jobs that act for one X account (`<handle>` is
 * the first argument): the handle is given, configured when
 * `requireAccount`, and has an OAuth2 credential file unless
 * `requireOAuth` is false. Each unmet check
 * skips the run (`[skip] <reason>`, exit 0).
 */
export const xHandlePrerequisite =
  (check: XHandleCheck) =>
  ({ args }: JobContext): true | string => {
    const handle = args[0];
    if (!handle)
      return `No X account handle provided. Usage: jeeves-scripts run <job-id> <handle> (${check.scriptName})`;
    if (check.requireAccount && !check.accounts()[handle])
      return `X account '${handle}' is not in integrations.x.accounts in jeeves-scripts.json`;
    if (
      check.requireOAuth !== false &&
      !fs.existsSync(getOAuthPath(check.oauthDir(), handle))
    )
      return 'X OAuth2 credentials not configured';
    return true;
  };

const userIdCache = new Map<string, string>();

/**
 * An X API client for a handle from its credential file; `null` (logged
 * as a skip) when the file or its access token is missing.
 */
export function createXClient(
  oauthDir: string,
  handle: string,
): XClient | null {
  const creds = readOAuthCredentials(oauthDir, handle);
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

/**
 * Run `fn` with a client for the handle; on a 401 refresh the token and
 * retry once with a fresh client.
 *
 * @throws When there are no credentials, the refresh fails, or `fn` fails otherwise.
 */
export async function withAutoRefresh<T>(
  oauthDir: string,
  handle: string,
  fn: (client: XClient) => Promise<T>,
  refresh: (handle: string) => Promise<TokenRefreshResult | null> = (h) =>
    refreshOAuth2Token(oauthDir, h),
): Promise<T> {
  const client = createXClient(oauthDir, handle);
  if (!client) throw new Error(`No X credentials for @${handle}`);
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.log(`x-api: 401 for @${handle}, refreshing token...`);
      const refreshed = await refresh(handle);
      if (!refreshed) throw err;
      return await fn(new Client({ accessToken: refreshed.accessToken }));
    }
    throw err;
  }
}

/** Resolve a handle to a user id, caching the result. */
export async function lookupUser(
  client: XUserLookupClient,
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
