/**
 * @module x/lib/x-deps.test-helper
 *
 * X runnable collaborators for tests: a temp directory with one account
 * (`example`) and its OAuth file, the in-memory runner, a fake API client
 * passed to every call, a fixed clock and console capture. Test support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { vi } from 'vitest';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import type { XClient } from './x-client.js';
import type { XJobDeps } from './x-deps.js';

/** The fixed clock. */
export const X_NOW = new Date('2026-03-01T12:00:00Z');

/** The configured test account handle. */
export const X_HANDLE = 'example';

const notStubbed = (name: string) => () =>
  Promise.reject(new Error(`X client ${name} not stubbed`));

/**
 * A complete {@link XClient} whose every call rejects; spread it and
 * replace the calls a test exercises.
 */
export const unstubbedXClient = (): XClient => ({
  users: {
    getByUsername: notStubbed('users.getByUsername'),
    getPosts: notStubbed('users.getPosts'),
    getMentions: notStubbed('users.getMentions'),
    getTimeline: notStubbed('users.getTimeline'),
    getLikedPosts: notStubbed('users.getLikedPosts'),
    getBookmarks: notStubbed('users.getBookmarks'),
    likePost: notStubbed('users.likePost'),
    unlikePost: notStubbed('users.unlikePost'),
    repostPost: notStubbed('users.repostPost'),
    unrepostPost: notStubbed('users.unrepostPost'),
  },
  posts: { create: notStubbed('posts.create') },
});

/** Console output captured by {@link captureConsole}. */
export interface CapturedConsole {
  logs: string[];
  errors: string[];
}

/**
 * Silence `console.log` and `console.error`, recording each call as one
 * line. Restored by `vi.restoreAllMocks()`.
 */
export function captureConsole(): CapturedConsole {
  const captured: CapturedConsole = { logs: [], errors: [] };
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    captured.logs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    captured.errors.push(a.map(String).join(' '));
  });
  return captured;
}

/** A test X world. */
export interface XWorld {
  dir: string;
  accountDir: string;
  client: XClient;
  runner: ReturnType<typeof fakeRunnerClient>;
  deps: XJobDeps;
  cleanup: () => void;
}

/** One configured account {@link X_HANDLE} with an OAuth file; `client` is handed to every call. */
export function xWorld(client: XClient = unstubbedXClient()): XWorld {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));
  const accountDir = path.join(dir, 'x', X_HANDLE);
  const oauthDir = path.join(dir, 'oauth');
  fs.mkdirSync(oauthDir, { recursive: true });
  fs.writeFileSync(path.join(oauthDir, `x-${X_HANDLE}-oauth2.json`), '{}');
  const runner = fakeRunnerClient();
  const deps: XJobDeps = {
    accounts: { [X_HANDLE]: accountDir },
    oauthDir,
    runner: () => runner.client,
    withClient: (_handle, fn) => fn(client),
    refresh: () => Promise.resolve(null),
    now: () => X_NOW,
  };
  return {
    dir,
    accountDir,
    client,
    runner,
    deps,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
