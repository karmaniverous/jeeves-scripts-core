/**
 * @module x/lib/x-deps.test-helper
 *
 * X runnable collaborators for tests: a temp directory with one account
 * (`karma`) and its OAuth file, the in-memory runner, a fake API client
 * passed to every call, and a fixed clock. Test support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Client } from '@xdevplatform/xdk';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import type { XJobDeps } from './x-deps.js';

/** The fixed clock. */
export const X_NOW = new Date('2026-03-01T12:00:00Z');

/** A test X world. */
export interface XWorld {
  dir: string;
  accountDir: string;
  runner: ReturnType<typeof fakeRunnerClient>;
  deps: XJobDeps;
  cleanup: () => void;
}

/** One configured account `karma` with an OAuth file; `client` is handed to every call. */
export function xWorld(client: unknown = {}): XWorld {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));
  const accountDir = path.join(dir, 'x', 'karma');
  const oauthDir = path.join(dir, 'oauth');
  fs.mkdirSync(oauthDir, { recursive: true });
  fs.writeFileSync(path.join(oauthDir, 'x-karma-oauth2.json'), '{}');
  const runner = fakeRunnerClient();
  const deps: XJobDeps = {
    accounts: { karma: accountDir },
    oauthDir,
    runner: () => runner.client,
    withClient: (_handle, fn) => fn(client as Client),
    refresh: () => Promise.resolve(null),
    now: () => X_NOW,
  };
  return {
    dir,
    accountDir,
    runner,
    deps,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
