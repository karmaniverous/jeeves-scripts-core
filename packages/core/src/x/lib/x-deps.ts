/**
 * @module x/lib/x-deps
 *
 * What the X runnables read and call (accounts, the OAuth directory, the
 * runner client, an authenticated client per handle, the clock), and the
 * live values resolved from `jeeves-scripts.json` when a runnable runs.
 */

import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';
import type { Client } from '@xdevplatform/xdk';

import { constants } from '../../lib/constants.js';
import { withAutoRefresh } from './x-api.js';
import { refreshOAuth2Token, type TokenRefreshResult } from './x-oauth.js';

/** The X runnables' collaborators. */
export interface XJobDeps {
  /** `X_ACCOUNTS`: handle to content directory (through its silo). */
  accounts: Readonly<Record<string, string>>;
  /** `X_OAUTH_DIR` (`{credentialsDir}/oauth`). */
  oauthDir: string;
  /** Runner queues. */
  runner: () => Pick<
    RunnerClient,
    'enqueue' | 'dequeue' | 'done' | 'fail' | 'close'
  >;
  /** Run a call with an authenticated client (refreshing on 401). */
  withClient: <T>(
    handle: string,
    fn: (client: Client) => Promise<T>,
  ) => Promise<T>;
  /** Refresh a handle's token. */
  refresh: (handle: string) => Promise<TokenRefreshResult | null>;
  /** Clock. */
  now: () => Date;
}

/** The live collaborators, from config. */
export const xJobDeps = (): XJobDeps => {
  const { X_ACCOUNTS: accounts, X_OAUTH_DIR: oauthDir } = constants();
  return {
    accounts,
    oauthDir,
    runner: () => getRunnerClient(),
    withClient: (handle, fn) => withAutoRefresh(oauthDir, handle, fn),
    refresh: (handle) => refreshOAuth2Token(oauthDir, handle),
    now: () => new Date(),
  };
};

/** The handle prerequisite's config reads (at check time). */
export const xConfig = {
  accounts: (): Readonly<Record<string, string>> => constants().X_ACCOUNTS,
  oauthDir: (): string => constants().X_OAUTH_DIR,
};
