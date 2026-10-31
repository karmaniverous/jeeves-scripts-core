/**
 * @module github/lib/file-sync-gh.test-helper
 *
 * A fake GitHub for the `github-sync-files` tests, generalised from the
 * prototype's fixture: the acting user's repos (one missing the ruleset and
 * the file, one archived) and an org's two repos whose file is current and
 * stale, answered through {@link githubWorld} (so `gh auth switch` and
 * `gh api user` behave), plus a temp instance repo holding the source
 * file, the default settings, and call, write and payload views. Neutral
 * names only. Test support only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import type { GithubRuleset } from '../../config/github-sync-files-schema.js';
import type { GhResult } from '../../lib/gh.js';
import type { SyncFilesSettings } from '../sync-files.js';
import { gitBlobSha } from './file-sync.js';
import {
  type GhAnswer,
  type GitHubWorld,
  githubWorld,
} from './github-deps.test-helper.js';

/** The acting account, which owns the `user` repos. */
export const ACCOUNT = 'example-user';
/** The org. */
export const ORG = 'example-org';
/** The login active before the run (restored afterwards). */
export const OPERATOR = 'example-operator';
/** The bot user (the default account). */
export const BOT = 'example-bot';
/** The synced file's source (under the instance root) and target. */
export const SOURCE = 'github/copilot-instructions.md';
export const TARGET = '.github/copilot-instructions.md';
/** The source file's content. */
export const CONTENT = '# Review instructions\n\nBe kind; be precise.\n';

/** The ruleset, in the prototype's shape. */
export const RULESET: GithubRuleset = {
  name: 'PR Review',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
  rules: [
    {
      type: 'copilot_code_review',
      parameters: { review_on_push: true, review_draft_pull_requests: true },
    },
  ],
  bypass_actors: [],
};

/** Base64 of a string. */
export const b64 = (s: string | Buffer): string =>
  (typeof s === 'string' ? Buffer.from(s, 'utf8') : s).toString('base64');

/** A failed call (`gh` exits non-zero). */
export const fail = (message: string): Error => new Error(message);

/** A 404. */
export const missing = (): Error => fail('HTTP 404');

/** A repo listing entry. */
export const repo = (fullName: string, archived = false) => ({
  name: fullName.split('/')[1],
  full_name: fullName,
  archived,
  default_branch: 'main',
});

/** The default GitHub. */
export const defaultAnswer = (call: string): GhAnswer => {
  if (call.includes('/user/repos'))
    return [repo(`${ACCOUNT}/new`), repo(`${ACCOUNT}/old`, true)];
  if (call.includes(`/orgs/${ORG}/repos`))
    return [repo(`${ORG}/same`), repo(`${ORG}/stale`)];
  if (call === `api /repos/${ACCOUNT}/new/rulesets`) return [];
  if (call.includes(`contents/${TARGET}?ref=main`)) {
    if (call.includes(`${ORG}/same/`))
      return {
        sha: gitBlobSha(Buffer.from(CONTENT)),
        content: b64(CONTENT),
        encoding: 'base64',
      };
    if (call.includes(`${ORG}/stale/`))
      return { sha: 's2', content: b64('old'), encoding: 'base64' };
    return missing();
  }
  // Any other file read: not there (GitHub answers 404).
  if (call.includes('/contents/') && call.includes('?ref=')) return missing();
  return '';
};

/** A sync-files test world. */
export interface SyncFilesWorld extends GitHubWorld {
  /** The temp instance repo root. */
  root: string;
  /** Every `gh` call, joined. */
  calls: () => string[];
  /** The POST and PUT calls. */
  writes: () => string[];
  /** The `--input` payloads, in call order. */
  payloads: Record<string, unknown>[];
  /** The default settings (`overrides` merged over them). */
  settings: (overrides?: Partial<SyncFilesSettings>) => SyncFilesSettings;
}

/**
 * Build a world; `override(call)` answers first (`undefined` falls through
 * to {@link defaultAnswer}; a thrown error is a repo whose calls throw).
 */
export function syncFilesWorld(
  override: (call: string) => GhAnswer = () => undefined,
): SyncFilesWorld {
  const payloads: Record<string, unknown>[] = [];
  const world = githubWorld(
    (args) => {
      const at = args.indexOf('--input');
      if (at >= 0)
        payloads.push(
          JSON.parse(fs.readFileSync(args[at + 1] ?? '', 'utf8')) as Record<
            string,
            unknown
          >,
        );
      const call = args.join(' ');
      return override(call) ?? defaultAnswer(call);
    },
    { account: OPERATOR, botUser: BOT },
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-files-root-'));
  fs.mkdirSync(path.join(root, 'github'));
  fs.writeFileSync(path.join(root, SOURCE), CONTENT);
  const calls = () => world.ghCalls.map((c) => c.join(' '));
  return {
    ...world,
    root,
    calls,
    writes: () => calls().filter((c) => / -X (POST|PUT) /.test(c)),
    payloads,
    settings: (overrides = {}) => ({
      files: [{ source: SOURCE, target: TARGET }],
      owners: [
        { owner: ACCOUNT, type: 'user' },
        { owner: ORG, type: 'org', ruleset: false },
      ],
      account: ACCOUNT,
      ruleset: RULESET,
      live: true,
      root,
      ...overrides,
    }),
    cleanup: () => {
      world.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Register the hooks every `github-sync-files` suite shares (silence
 * `console.log`; after each test, clean up every world it built and
 * restore mocks) and return the builder for a test's world
 * ({@link syncFilesWorld}).
 */
export function useSyncFilesWorld(): (
  override?: (call: string) => GhAnswer,
) => SyncFilesWorld {
  const worlds: SyncFilesWorld[] = [];
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    for (const w of worlds.splice(0)) w.cleanup();
    vi.restoreAllMocks();
  });
  return (override) => {
    const w = syncFilesWorld(override);
    worlds.push(w);
    return w;
  };
}

/** A successful `gh` result printing `out`. */
export const ghOk = (out: string): GhResult => ({
  ok: true,
  status: 0,
  out,
  err: '',
});

/**
 * Answer the world's `gh` calls with `fn` first: a result is recorded as
 * a call and returned; `undefined` passes the call on to the world's
 * `gh`; a throw is a `gh` failure (not recorded).
 */
export const interceptGh = (
  x: GitHubWorld,
  fn: (args: string[]) => GhResult | undefined,
): void => {
  const gh = x.deps.gh;
  x.deps.gh = (args, options) => {
    const r = fn(args);
    if (r === undefined) return gh(args, options);
    x.ghCalls.push(args);
    return r;
  };
};
