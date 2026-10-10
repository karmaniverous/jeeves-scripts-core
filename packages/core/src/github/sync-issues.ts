#!/usr/bin/env tsx
/**
 * @module sync-issues
 *
 * Sync GitHub issues in round-robin batches via runner state_items.
 *
 * Called by the jeeves-runner scheduler. Reads the repo registry at
 * constants().GITHUB_REGISTRY_PATH, maintains a state_items queue, then fetches
 * issues for the oldest BATCH_SIZE repos using `gh search issues`.
 * Each issue is stored as a JSON file with diff history via
 * fast-json-patch. Requires constants().GH_ACCOUNT and constants().GH_BIN for auth.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ensureDir,
  nowIso,
  readJson,
  run,
  runScript,
  sleepAsync,
} from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';
import jsonpatch from 'fast-json-patch';
const compare = jsonpatch.compare.bind(jsonpatch);

import { getBasePathForGitHubOrg } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { gh, setupGhConfig } from '../lib/gh.js';

setupGhConfig();

const MAX_HISTORY = 50;
const SEARCH_DELAY_MS = 3000;
const BATCH_SIZE = 10;
const STATE_NS = 'github';
const STATE_KEY = 'issues-sync';

interface Issue {
  number: number;
  title: string;
  state: string;
  body?: string;
  labels?: (string | { name: string })[];
  assignees?: (string | { login: string })[];
  createdAt: string;
  updatedAt: string;
  commentsCount?: number;
  url: string;
}

function fetchIssues(ownerRepo: string, sinceDate: string | null): Issue[] {
  const args = [
    'search',
    'issues',
    '--repo',
    ownerRepo,
    '--limit',
    '200',
    '--sort',
    'updated',
    '--order',
    'desc',
    '--json',
    'number,title,state,body,labels,assignees,createdAt,updatedAt,commentsCount,url',
  ];
  if (sinceDate) args.push('--updated', `>=${sinceDate}`);
  const result = gh(args);
  if (!result.out || result.out === '[]') return [];
  return JSON.parse(result.out) as Issue[];
}

function processIssue(issuesDir: string, issue: Issue): void {
  const num = issue.number;
  const filePath = path.join(issuesDir, `${String(num)}.json`);
  const now = nowIso();

  const current = {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    body: issue.body ?? '',
    labels: (issue.labels ?? []).map((l) =>
      typeof l === 'string' ? l : l.name,
    ),
    assignees: (issue.assignees ?? []).map((a) =>
      typeof a === 'string' ? a : a.login,
    ),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    comments: issue.commentsCount ?? 0,
    url: issue.url,
  };

  const existing = readJson<{
    current?: Record<string, unknown>;
    history?: { ts: string; patch: unknown[] }[];
    meta?: { firstSeen?: string; version?: number };
  } | null>(filePath, null);

  if (existing?.current) {
    const patches = compare(
      current as Record<string, unknown>,
      existing.current,
    );
    const history = existing.history ?? [];
    if (patches.length > 0) {
      history.unshift({ ts: now, patch: patches });
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    }

    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          entityType: 'issue',
          entityKey: String(num),
          current,
          history,
          meta: {
            firstSeen: existing.meta?.firstSeen ?? now,
            lastSync: now,
            version: (existing.meta?.version ?? 0) + 1,
          },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  } else {
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          entityType: 'issue',
          entityKey: String(num),
          current,
          history: [],
          meta: { firstSeen: now, lastSync: now, version: 1 },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(constants().GH_CONFIG_DIR)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  const client = getRunnerClient();

  try {
    console.log(
      `[issues-sync] start ${nowIso()} (batch=${String(BATCH_SIZE)})`,
    );
    try {
      run(constants().GH_BIN, ['auth', 'switch', '-u', constants().GH_ACCOUNT]);
    } catch (e) {
      console.log(
        `[issues-sync] warning: account switch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const registry = readJson<{
      repos: Record<string, { isArchived?: boolean }>;
    }>(constants().GITHUB_REGISTRY_PATH, { repos: {} });

    const existingCount = client.countItems(STATE_NS, STATE_KEY);
    if (existingCount === 0) {
      const keys = Object.keys(registry.repos).filter(
        (k) => !registry.repos[k]?.isArchived,
      );
      console.log(`[issues-sync] seeding ${String(keys.length)} repos`);
      for (const key of keys) {
        client.setItem(
          STATE_NS,
          STATE_KEY,
          key,
          JSON.stringify({ lastSyncedAt: null, issueCount: 0 }),
        );
      }
    }

    // Add new repos
    const regKeys = new Set(
      Object.keys(registry.repos).filter((k) => !registry.repos[k]?.isArchived),
    );
    const exKeys = new Set(client.listItemKeys(STATE_NS, STATE_KEY));
    for (const key of regKeys) {
      if (!exKeys.has(key)) {
        console.log(`[issues-sync] adding: ${key}`);
        client.setItem(
          STATE_NS,
          STATE_KEY,
          key,
          JSON.stringify({ lastSyncedAt: null, issueCount: 0 }),
        );
      }
    }

    const allKeys = client.listItemKeys(STATE_NS, STATE_KEY);
    const items = allKeys
      .map((k) => {
        const val = JSON.parse(
          client.getItem(STATE_NS, STATE_KEY, k) ?? '{}',
        ) as { lastSyncedAt?: string };
        return {
          key: k,
          lastSyncedAt: val.lastSyncedAt ?? '1970-01-01T00:00:00Z',
        };
      })
      .sort((a, b) => a.lastSyncedAt.localeCompare(b.lastSyncedAt))
      .slice(0, BATCH_SIZE);

    let processed = 0,
      errors = 0,
      totalIssues = 0;

    for (const item of items) {
      const [owner = '', repo = ''] = item.key.split('/');
      const basePath = getBasePathForGitHubOrg(owner);
      const issuesDir = path.join(basePath, 'github', owner, repo, 'issues');
      ensureDir(issuesDir);

      const sinceDate =
        item.lastSyncedAt !== '1970-01-01T00:00:00Z'
          ? new Date(item.lastSyncedAt).toISOString().slice(0, 10)
          : null;

      try {
        const issues = fetchIssues(item.key, sinceDate);
        for (const issue of issues) processIssue(issuesDir, issue);

        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({ lastSyncedAt: nowIso(), issueCount: issues.length }),
        );
        processed++;
        totalIssues += issues.length;
        if (issues.length > 0)
          console.log(
            `[issues-sync] ${item.key}: ${String(issues.length)} issues`,
          );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[issues-sync] ERROR ${item.key}: ${msg}`);
        errors++;
        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({
            lastSyncedAt: nowIso(),
            issueCount: 0,
            lastError: msg,
          }),
        );
      }

      await sleepAsync(SEARCH_DELAY_MS);
    }

    console.log(
      `[issues-sync] end ${nowIso()} - batch ${String(processed)}/${String(items.length)}, ${String(totalIssues)} issues, ${String(errors)} errors`,
    );
  } finally {
    client.close();
  }
}

runScript('github/sync-issues', () => {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
