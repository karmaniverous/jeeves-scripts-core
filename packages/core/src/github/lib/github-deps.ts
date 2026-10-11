/**
 * @module github/lib/github-deps
 *
 * What the GitHub runnables read and call: the gh settings (config dir,
 * binary, account, bot user), the archive paths, `gh` and command runners,
 * the runner client and the clock; the live values are resolved from
 * `jeeves-scripts.json` when a runnable runs (never at import), which is
 * also when `GH_CONFIG_DIR` is set for the `gh` child processes. Also the
 * round-robin batch over a registry kept in runner state items, shared by
 * the repo and issue syncs.
 */

import { nowIso, run, sleepAsync } from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { getBasePathForGitHubOrg } from '../../config/index.js';
import { constants } from '../../lib/constants.js';
import { gh, type GhResult, setupGhConfig } from '../../lib/gh.js';

/** A runner client as the GitHub jobs use it. */
export type GitHubRunner = Pick<
  RunnerClient,
  | 'getState'
  | 'setState'
  | 'countItems'
  | 'setItem'
  | 'getItem'
  | 'listItemKeys'
  | 'enqueue'
  | 'dequeue'
  | 'done'
  | 'fail'
  | 'close'
>;

/** The GitHub runnables' collaborators. */
export interface GitHubJobDeps {
  /** `GH_CONFIG_DIR`; the jobs skip when it does not exist. */
  configDir: string;
  /** The `gh` binary. */
  bin: string;
  /** `integrations.gh.account`. */
  account: string;
  /** `integrations.gh.botUser`. */
  botUser: string;
  /** `{contentDir}/github`. */
  githubDir: string;
  /** The repo registry file. */
  registryPath: string;
  /** The silo base path of an owner. */
  orgBase: (owner: string) => string;
  /** Run `gh` with structured output. */
  gh: (args: string[], options?: { allowFail?: boolean }) => GhResult;
  /** Run a command (git, gh auth switch); throws on failure. */
  run: (cmd: string, args: string[]) => string;
  /** Runner state, items and queues. */
  runner: () => GitHubRunner;
  /** ISO timestamp. */
  now: () => string;
  /** Delay between rate-limited calls. */
  sleep: (ms: number) => Promise<void>;
}

/** The live collaborators, from config; sets `GH_CONFIG_DIR`. */
export const githubJobDeps = (): GitHubJobDeps => {
  setupGhConfig();
  const c = constants();
  return {
    configDir: c.GH_CONFIG_DIR,
    bin: c.GH_BIN,
    account: c.GH_ACCOUNT,
    botUser: c.GH_BOT_USER,
    githubDir: c.GITHUB_DIR,
    registryPath: c.GITHUB_REGISTRY_PATH,
    orgBase: getBasePathForGitHubOrg,
    gh,
    run: (cmd, args) => run(cmd, args),
    runner: () => getRunnerClient(),
    now: nowIso,
    sleep: sleepAsync,
  };
};

/** GET a REST endpoint through `gh api`; `null` for an empty body. */
export const ghApiVia = (
  deps: Pick<GitHubJobDeps, 'gh'>,
  endpoint: string,
): unknown => {
  const { out } = deps.gh(['api', endpoint]);
  return out ? (JSON.parse(out) as unknown) : null;
};

/** The registry file shape the syncs read. */
export interface RepoRegistry {
  repos: Record<string, { defaultBranch?: string; isArchived?: boolean }>;
}

/** The never-synced timestamp. */
export const NEVER = '1970-01-01T00:00:00Z';

/**
 * Keep the round-robin items in step with the registry: every unarchived
 * repo not yet tracked is added with `initial(key)` (logged as seeding when
 * nothing was tracked, else as an addition).
 */
export function seedRoundRobin(
  client: GitHubRunner,
  ns: string,
  stateKey: string,
  registry: RepoRegistry,
  initial: (key: string) => Record<string, unknown>,
  log: { seeding: (n: number) => string; adding: (key: string) => string },
): void {
  const keys = Object.keys(registry.repos).filter(
    (k) => !registry.repos[k]?.isArchived,
  );
  const fresh = client.countItems(ns, stateKey) === 0;
  if (fresh) console.log(log.seeding(keys.length));
  const tracked = new Set(client.listItemKeys(ns, stateKey));
  for (const key of keys) {
    if (tracked.has(key)) continue;
    if (!fresh) console.log(log.adding(key));
    client.setItem(ns, stateKey, key, JSON.stringify(initial(key)));
  }
}

/** The `size` least recently synced items, oldest first, with their stored values. */
export function oldestBatch(
  client: GitHubRunner,
  ns: string,
  stateKey: string,
  size: number,
): { key: string; lastSyncedAt: string; value: Record<string, unknown> }[] {
  return client
    .listItemKeys(ns, stateKey)
    .map((key) => {
      const value = JSON.parse(
        client.getItem(ns, stateKey, key) ?? '{}',
      ) as Record<string, unknown>;
      const last = value.lastSyncedAt;
      return {
        key,
        lastSyncedAt: typeof last === 'string' ? last : NEVER,
        value,
      };
    })
    .sort((a, b) => a.lastSyncedAt.localeCompare(b.lastSyncedAt))
    .slice(0, size);
}
