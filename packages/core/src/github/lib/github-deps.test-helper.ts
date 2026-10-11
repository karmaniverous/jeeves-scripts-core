/**
 * @module github/lib/github-deps.test-helper
 *
 * GitHub runnable collaborators for tests: a temp directory holding the gh
 * config dir and the archive, a scripted `gh` (answers by matching the
 * joined arguments), a recording command runner, the in-memory runner and
 * a fixed clock. Test support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import type { GhResult } from '../../lib/gh.js';
import type { GitHubJobDeps } from './github-deps.js';

/** The fixed clock. */
export const GH_NOW = '2026-04-01T12:00:00.000Z';

/** A scripted answer: JSON body (stringified), or a failure. */
export type GhAnswer = unknown;

/** A test GitHub world. */
export interface GitHubWorld {
  dir: string;
  deps: GitHubJobDeps;
  runner: ReturnType<typeof fakeRunnerClient>;
  ghCalls: string[][];
  runCalls: string[][];
  cleanup: () => void;
}

/**
 * Build a world. `answer(args)` returns the body for a `gh` call
 * (`undefined`: empty output; an `Error`: a failed call).
 */
export function githubWorld(
  answer: (args: string[]) => GhAnswer = () => undefined,
  over: Partial<GitHubJobDeps> = {},
): GitHubWorld {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
  const configDir = path.join(dir, 'gh-config');
  fs.mkdirSync(configDir);
  const githubDir = path.join(dir, 'content', 'github');
  fs.mkdirSync(githubDir, { recursive: true });
  const runner = fakeRunnerClient();
  const ghCalls: string[][] = [];
  const runCalls: string[][] = [];
  const gh = (
    args: string[],
    options: { allowFail?: boolean } = {},
  ): GhResult => {
    ghCalls.push(args);
    const body = answer(args);
    if (body instanceof Error) {
      if (options.allowFail)
        return { ok: false, status: 1, out: '', err: body.message };
      throw body;
    }
    const out =
      body === undefined
        ? ''
        : typeof body === 'string'
          ? body
          : JSON.stringify(body);
    return { ok: true, status: 0, out, err: '' };
  };
  const deps: GitHubJobDeps = {
    configDir,
    bin: 'gh',
    account: 'acme',
    botUser: 'acme-bot',
    githubDir,
    registryPath: path.join(githubDir, 'registry.json'),
    orgBase: () => path.join(dir, 'content'),
    gh,
    run: (cmd, args) => {
      runCalls.push([cmd, ...args]);
      return '';
    },
    runner: () => runner.client,
    now: () => GH_NOW,
    sleep: () => Promise.resolve(),
    ...over,
  };
  return {
    dir,
    deps,
    runner,
    ghCalls,
    runCalls,
    cleanup: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
