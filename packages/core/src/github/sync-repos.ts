/**
 * @module github/sync-repos
 *
 * Syncs GitHub repo clones in round-robin batches through runner state
 * items (`github` / `repos-sync`): reads the repo registry, tracks every
 * unarchived repo, then shallow-clones or hard-resets the
 * {@link BATCH_SIZE} least recently synced. A mirror follows the repo's
 * current default branch; one that can't be brought up to date is cloned
 * afresh beside it and swapped in. A repo that still fails is recorded,
 * and the run fails after the batch (#48). Skips when the gh config
 * directory does not exist. Mirrors are reference copies: nothing is ever
 * committed in them.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, getErrorMessage, readJson } from '@karmaniverous/jeeves';

import { defineRunnable } from '../runnables/define-runnable.js';
import {
  ghReady,
  type GitHubJobDeps,
  githubJobDeps,
  oldestBatch,
  type RepoRegistry,
  seedRoundRobin,
  verifyActingAccount,
} from './lib/github-deps.js';

/** Repos synced per run. */
export const BATCH_SIZE = 15;
const STATE_NS = 'github';
const STATE_KEY = 'repos-sync';

type SyncDeps = Pick<GitHubJobDeps, 'orgBase' | 'run'>;

/** Shallow single-branch clone of `branch` into `dir`. */
const cloneInto = (
  deps: SyncDeps,
  url: string,
  branch: string,
  dir: string,
): void => {
  deps.run('git', ['clone', '--depth', '1', '--branch', branch, url, dir]);
};

/**
 * Bring an existing mirror to `origin/<branch>`. When the checked-out
 * branch differs (the repo's default branch changed), the single-branch
 * clone's refspec is switched first; the fetch names its destination ref,
 * so `origin/<branch>` exists whatever the stored refspec (#48).
 */
function pull(
  deps: SyncDeps,
  repoDir: string,
  url: string,
  branch: string,
): void {
  const git = (...args: string[]) => deps.run('git', ['-C', repoDir, ...args]);
  git('remote', 'set-url', 'origin', url);
  const current = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (current !== branch) {
    console.log(`BRANCH ${repoDir}: ${current || '?'} -> ${branch}`);
    git('remote', 'set-branches', 'origin', branch);
  }
  git(
    'fetch',
    '--depth',
    '1',
    'origin',
    `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
  );
  git('checkout', '-B', branch, `origin/${branch}`);
  git('reset', '--hard', `origin/${branch}`);
  git('clean', '-fdx');
}

/** Remove `dir` if present; a failure only warns (the next sync retries). */
function removeQuietly(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.log(
      `[repo-sync] warning: could not remove ${dir}: ${getErrorMessage(e)}`,
    );
  }
}

/**
 * Run each rollback step, so one failing doesn't skip the rest; the caller
 * rethrows its own error, never a rollback's.
 */
function rollBack(...steps: (() => void)[]): void {
  for (const step of steps) {
    try {
      step();
    } catch (e) {
      console.log(
        `[repo-sync] warning: rollback step failed: ${getErrorMessage(e)}`,
      );
    }
  }
}

/**
 * Replace `repoDir` with a fresh clone of `branch`: clone beside it
 * (`repo.fresh`), move the old mirror aside (`repo.old`), move the clone
 * in, delete the old one; the mirror's neighbours (e.g. `.meta/`) are
 * untouched. Any failure before the swap completes leaves the
 * old mirror at `repoDir` and no copy behind, and rethrows the original
 * error (#61 reviews). Leftover copies are also cleared on every sync.
 */
function reclone(
  deps: SyncDeps,
  repoDir: string,
  url: string,
  branch: string,
): void {
  const fresh = `${repoDir}.fresh`;
  const old = `${repoDir}.old`;
  removeQuietly(fresh);
  removeQuietly(old);
  try {
    cloneInto(deps, url, branch, fresh);
  } catch (e) {
    rollBack(() => {
      fs.rmSync(fresh, { recursive: true, force: true });
    });
    throw e;
  }
  try {
    fs.renameSync(repoDir, old);
  } catch (e) {
    rollBack(() => {
      fs.rmSync(fresh, { recursive: true, force: true });
    });
    throw e;
  }
  try {
    fs.renameSync(fresh, repoDir);
  } catch (e) {
    rollBack(
      () => {
        fs.renameSync(old, repoDir);
      },
      () => {
        fs.rmSync(fresh, { recursive: true, force: true });
      },
    );
    throw e;
  }
  removeQuietly(old);
}

/** Clone the repo, or bring an existing mirror to its default branch. */
function syncOne(
  ownerRepo: string,
  defaultBranch: string,
  deps: SyncDeps,
): void {
  const [owner = '', repo = ''] = ownerRepo.split('/');
  const target = path.join(deps.orgBase(owner), 'github', owner, repo);
  const repoDir = path.join(target, 'repo');
  const url = `https://github.com/${ownerRepo}.git`;
  // Copies a failed or interrupted reclone left behind (#61 review).
  removeQuietly(`${repoDir}.fresh`);
  removeQuietly(`${repoDir}.old`);

  if (!fs.existsSync(repoDir)) {
    console.log(`CLONE ${ownerRepo} -> ${repoDir} (${defaultBranch})`);
    ensureDir(target);
    cloneInto(deps, url, defaultBranch, repoDir);
    return;
  }

  console.log(`PULL  ${ownerRepo} -> ${repoDir} (${defaultBranch})`);
  try {
    pull(deps, repoDir, url, defaultBranch);
  } catch (e) {
    console.log(
      `RECLONE ${ownerRepo} (${defaultBranch}) after: ${getErrorMessage(e)}`,
    );
    reclone(deps, repoDir, url, defaultBranch);
  }
}

/** Sync the next batch of repos. */
export function syncRepos(deps: GitHubJobDeps): void {
  if (!ghReady(deps)) return;
  const client = deps.runner();
  try {
    console.log(
      `[repo-sync] start ${deps.now()} (batch=${String(BATCH_SIZE)})`,
    );
    deps.run(deps.bin, ['auth', 'switch', '-u', deps.account]);
    verifyActingAccount(deps, deps.account);

    const registry = readJson<RepoRegistry>(deps.registryPath, { repos: {} });
    seedRoundRobin(
      client,
      STATE_NS,
      STATE_KEY,
      registry,
      (key) => ({
        lastSyncedAt: null,
        defaultBranch: registry.repos[key]?.defaultBranch ?? 'main',
      }),
      {
        seeding: (n) => `[repo-sync] seeding ${String(n)} repos`,
        adding: (key) => `[repo-sync] adding new repo: ${key}`,
      },
    );

    const items = oldestBatch(client, STATE_NS, STATE_KEY, BATCH_SIZE);
    console.log(`[repo-sync] processing batch of ${String(items.length)}`);
    let processed = 0,
      errors = 0;

    for (const item of items) {
      const stored = item.value.defaultBranch;
      const defaultBranch =
        registry.repos[item.key]?.defaultBranch ??
        (typeof stored === 'string' ? stored : 'main');
      try {
        syncOne(item.key, defaultBranch, deps);
        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({ lastSyncedAt: deps.now(), defaultBranch }),
        );
        processed++;
      } catch (e) {
        const msg = getErrorMessage(e);
        console.log(`[repo-sync] ERROR ${item.key}: ${msg}`);
        errors++;
        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({
            lastSyncedAt: deps.now(),
            defaultBranch,
            lastError: msg,
          }),
        );
      }
    }

    console.log(
      `[repo-sync] end ${deps.now()} - batch ${String(processed)}/${String(items.length)}, ${String(errors)} errors`,
    );
    if (errors > 0)
      throw new Error(
        `[repo-sync] ${String(errors)} of ${String(items.length)} repos failed to sync`,
      );
  } finally {
    client.close();
  }
}

export default defineRunnable({
  id: 'github-sync-repos',
  domain: 'github',
  flags: {},
  name: 'github/sync-repos',
  run: () => {
    syncRepos(githubJobDeps());
  },
});
