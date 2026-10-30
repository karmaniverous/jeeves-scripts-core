/**
 * @module github/sync-repos
 *
 * Syncs GitHub repo clones in round-robin batches through runner state
 * items (`github` / `repos-sync`): reads the repo registry, tracks every
 * unarchived repo, then shallow-clones or hard-resets the
 * {@link BATCH_SIZE} least recently synced. Skips when the gh config
 * directory does not exist.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, readJson } from '@karmaniverous/jeeves';

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

/** Clone the repo, or reset an existing clone to the remote default branch. */
function syncOne(
  ownerRepo: string,
  defaultBranch: string,
  deps: Pick<GitHubJobDeps, 'orgBase' | 'run'>,
): void {
  const [owner = '', repo = ''] = ownerRepo.split('/');
  const target = path.join(deps.orgBase(owner), 'github', owner, repo);
  const repoDir = path.join(target, 'repo');
  const url = `https://github.com/${ownerRepo}.git`;

  if (!fs.existsSync(repoDir)) {
    console.log(`CLONE ${ownerRepo} -> ${repoDir} (${defaultBranch})`);
    ensureDir(target);
    deps.run('git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      defaultBranch,
      url,
      repoDir,
    ]);
    return;
  }

  console.log(`PULL  ${ownerRepo} -> ${repoDir} (${defaultBranch})`);
  deps.run('git', ['-C', repoDir, 'remote', 'set-url', 'origin', url]);
  deps.run('git', [
    '-C',
    repoDir,
    'fetch',
    '--depth',
    '1',
    'origin',
    defaultBranch,
  ]);
  deps.run('git', [
    '-C',
    repoDir,
    'checkout',
    '-B',
    defaultBranch,
    `origin/${defaultBranch}`,
  ]);
  deps.run('git', [
    '-C',
    repoDir,
    'reset',
    '--hard',
    `origin/${defaultBranch}`,
  ]);
  deps.run('git', ['-C', repoDir, 'clean', '-fdx']);
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
      const defaultBranch = typeof stored === 'string' ? stored : 'main';
      try {
        syncOne(item.key, defaultBranch, deps);
        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({
            lastSyncedAt: deps.now(),
            defaultBranch:
              registry.repos[item.key]?.defaultBranch ?? defaultBranch,
          }),
        );
        processed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
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
