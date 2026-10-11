/**
 * @module github/sync-issues
 *
 * Syncs GitHub issues in round-robin batches through runner state items
 * (`github` / `issues-sync`): for the {@link BATCH_SIZE} least recently
 * synced repos in the registry, searches the issues updated since the last
 * sync and stores each one under `{silo}/github/<owner>/<repo>/issues/` with
 * reverse-diff history. Skips when the gh config directory does not exist.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, readJson } from '@karmaniverous/jeeves';
import jsonpatch from 'fast-json-patch';

import { defineJob } from '../jobs/define-job.js';
import {
  type GitHubJobDeps,
  githubJobDeps,
  NEVER,
  oldestBatch,
  type RepoRegistry,
  seedRoundRobin,
} from './lib/github-deps.js';

const compare = jsonpatch.compare.bind(jsonpatch);

/** History entries kept per issue. */
export const MAX_HISTORY = 50;
/** Delay between repo searches (search API rate limit). */
export const SEARCH_DELAY_MS = 3000;
/** Repos synced per run. */
export const BATCH_SIZE = 10;
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

interface StoredIssue {
  current?: Record<string, unknown>;
  history?: { ts: string; patch: unknown[] }[];
  meta?: { firstSeen?: string; version?: number };
}

function fetchIssues(
  ownerRepo: string,
  sinceDate: string | null,
  deps: Pick<GitHubJobDeps, 'gh'>,
): Issue[] {
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
  const result = deps.gh(args);
  if (!result.out || result.out === '[]') return [];
  return JSON.parse(result.out) as Issue[];
}

/** Write the issue snapshot, adding a reverse patch to its history when it changed. */
function processIssue(issuesDir: string, issue: Issue, now: string): void {
  const num = String(issue.number);
  const filePath = path.join(issuesDir, `${num}.json`);
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
  const existing = readJson<StoredIssue | null>(filePath, null);
  const history = existing?.current ? (existing.history ?? []) : [];
  if (existing?.current) {
    const patches = compare(
      current as Record<string, unknown>,
      existing.current,
    );
    if (patches.length > 0) {
      history.unshift({ ts: now, patch: patches });
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    }
  }
  const meta = existing?.current
    ? {
        firstSeen: existing.meta?.firstSeen ?? now,
        lastSync: now,
        version: (existing.meta?.version ?? 0) + 1,
      }
    : { firstSeen: now, lastSync: now, version: 1 };
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      { entityType: 'issue', entityKey: num, current, history, meta },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

/** Sync the issues of the next batch of repos. */
export async function syncIssues(deps: GitHubJobDeps): Promise<void> {
  if (!fs.existsSync(deps.configDir)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }
  const client = deps.runner();
  try {
    console.log(
      `[issues-sync] start ${deps.now()} (batch=${String(BATCH_SIZE)})`,
    );
    try {
      deps.run(deps.bin, ['auth', 'switch', '-u', deps.account]);
    } catch (e) {
      console.log(
        `[issues-sync] warning: account switch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const registry = readJson<RepoRegistry>(deps.registryPath, { repos: {} });
    seedRoundRobin(
      client,
      STATE_NS,
      STATE_KEY,
      registry,
      () => ({ lastSyncedAt: null, issueCount: 0 }),
      {
        seeding: (n) => `[issues-sync] seeding ${String(n)} repos`,
        adding: (key) => `[issues-sync] adding: ${key}`,
      },
    );

    const items = oldestBatch(client, STATE_NS, STATE_KEY, BATCH_SIZE);
    let processed = 0,
      errors = 0,
      totalIssues = 0;

    for (const item of items) {
      const [owner = '', repo = ''] = item.key.split('/');
      const issuesDir = path.join(
        deps.orgBase(owner),
        'github',
        owner,
        repo,
        'issues',
      );
      ensureDir(issuesDir);
      const sinceDate =
        item.lastSyncedAt !== NEVER
          ? new Date(item.lastSyncedAt).toISOString().slice(0, 10)
          : null;

      try {
        const issues = fetchIssues(item.key, sinceDate, deps);
        for (const issue of issues) processIssue(issuesDir, issue, deps.now());
        client.setItem(
          STATE_NS,
          STATE_KEY,
          item.key,
          JSON.stringify({
            lastSyncedAt: deps.now(),
            issueCount: issues.length,
          }),
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
            lastSyncedAt: deps.now(),
            issueCount: 0,
            lastError: msg,
          }),
        );
      }
      await deps.sleep(SEARCH_DELAY_MS);
    }

    console.log(
      `[issues-sync] end ${deps.now()} - batch ${String(processed)}/${String(items.length)}, ${String(totalIssues)} issues, ${String(errors)} errors`,
    );
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'github-sync-issues',
  domain: 'github',
  name: 'github/sync-issues',
  run: () => syncIssues(githubJobDeps()),
});
