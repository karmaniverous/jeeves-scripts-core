#!/usr/bin/env tsx
/**
 * @module sync-repos
 *
 * Sync GitHub repo clones in round-robin batches via runner state_items.
 *
 * Called by the jeeves-runner scheduler. Reads the repo registry at
 * constants().GITHUB_REGISTRY_PATH, seeds or updates a state_items queue, then
 * shallow-clones or pulls the oldest BATCH_SIZE repos. Requires
 * constants().GH_ACCOUNT for auth switching and constants().GH_BIN for git-credential flow.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ensureDir,
  nowIso,
  readJson,
  run,
  runScript,
} from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getBasePathForGitHubOrg } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { setupGhConfig } from '../lib/gh.js';

setupGhConfig();

const BATCH_SIZE = 15;
const STATE_NS = 'github';
const STATE_KEY = 'repos-sync';

interface RegistryEntry {
  defaultBranch?: string;
  isArchived?: boolean;
}

interface Registry {
  repos: Record<string, RegistryEntry>;
}

function syncOne(ownerRepo: string, defaultBranch: string): void {
  const [owner = '', repo = ''] = ownerRepo.split('/');
  const basePath = getBasePathForGitHubOrg(owner);
  const target = path.join(basePath, 'github', owner, repo);
  const repoDir = path.join(target, 'repo');
  const url = `https://github.com/${ownerRepo}.git`;

  if (!fs.existsSync(repoDir)) {
    console.log(`CLONE ${ownerRepo} -> ${repoDir} (${defaultBranch})`);
    ensureDir(target);
    run('git', [
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
  run('git', ['-C', repoDir, 'remote', 'set-url', 'origin', url]);
  run('git', ['-C', repoDir, 'fetch', '--depth', '1', 'origin', defaultBranch]);
  run('git', [
    '-C',
    repoDir,
    'checkout',
    '-B',
    defaultBranch,
    `origin/${defaultBranch}`,
  ]);
  run('git', ['-C', repoDir, 'reset', '--hard', `origin/${defaultBranch}`]);
  run('git', ['-C', repoDir, 'clean', '-fdx']);
}

function main(): void {
  if (!fs.existsSync(constants().GH_CONFIG_DIR)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  const client = getRunnerClient();

  try {
    console.log(`[repo-sync] start ${nowIso()} (batch=${String(BATCH_SIZE)})`);
    run(constants().GH_BIN, ['auth', 'switch', '-u', constants().GH_ACCOUNT]);

    const existingCount = client.countItems(STATE_NS, STATE_KEY);
    const registry = readJson<Registry>(constants().GITHUB_REGISTRY_PATH, {
      repos: {},
    });

    if (existingCount === 0) {
      const keys = Object.keys(registry.repos).filter(
        (k) => !registry.repos[k]?.isArchived,
      );
      console.log(`[repo-sync] seeding ${String(keys.length)} repos`);
      for (const key of keys) {
        client.setItem(
          STATE_NS,
          STATE_KEY,
          key,
          JSON.stringify({
            lastSyncedAt: null,
            defaultBranch: registry.repos[key]?.defaultBranch ?? 'main',
          }),
        );
      }
    }

    // Add new repos from registry
    const registryKeys = new Set(
      Object.keys(registry.repos).filter((k) => !registry.repos[k]?.isArchived),
    );
    const existingKeys = new Set(client.listItemKeys(STATE_NS, STATE_KEY));
    for (const key of registryKeys) {
      if (!existingKeys.has(key)) {
        console.log(`[repo-sync] adding new repo: ${key}`);
        client.setItem(
          STATE_NS,
          STATE_KEY,
          key,
          JSON.stringify({
            lastSyncedAt: null,
            defaultBranch: registry.repos[key]?.defaultBranch ?? 'main',
          }),
        );
      }
    }

    // Get batch of oldest items
    const allKeys = client.listItemKeys(STATE_NS, STATE_KEY);
    const items = allKeys
      .map((k) => {
        const val = JSON.parse(
          client.getItem(STATE_NS, STATE_KEY, k) ?? '{}',
        ) as {
          lastSyncedAt?: string;
          defaultBranch?: string;
        };
        return {
          key: k,
          lastSyncedAt: val.lastSyncedAt ?? '1970-01-01T00:00:00Z',
          defaultBranch: val.defaultBranch ?? 'main',
        };
      })
      .sort((a, b) => a.lastSyncedAt.localeCompare(b.lastSyncedAt))
      .slice(0, BATCH_SIZE);

    console.log(`[repo-sync] processing batch of ${String(items.length)}`);
    let processed = 0,
      errors = 0;

    for (const item of items) {
      try {
        syncOne(item.key, item.defaultBranch);
        const r = registry.repos[item.key];
        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({
            lastSyncedAt: nowIso(),
            defaultBranch: r?.defaultBranch ?? item.defaultBranch,
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
            lastSyncedAt: nowIso(),
            defaultBranch: item.defaultBranch,
            lastError: msg,
          }),
        );
      }
    }

    console.log(
      `[repo-sync] end ${nowIso()} - batch ${String(processed)}/${String(items.length)}, ${String(errors)} errors`,
    );
  } finally {
    client.close();
  }
}

runScript('github/sync-repos', main);
