/**
 * Tests for the GitHub repo and issue syncs with injected collaborators:
 * a scripted `gh`, a recording command runner, the in-memory runner and a
 * temp archive.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRegistry } from './build-registry.js';
import { drainCollabs } from './drain-collabs.js';
import { githubJobDeps } from './lib/github-deps.js';
import {
  GH_NOW,
  type GitHubWorld,
  githubWorld,
} from './lib/github-deps.test-helper.js';
import { pollCollabs } from './poll-collabs.js';
import { BATCH_SIZE as ISSUE_BATCH, syncIssues } from './sync-issues.js';
import { BATCH_SIZE, syncRepos } from './sync-repos.js';
import { watchNotifications } from './watch.js';

let w: GitHubWorld;
let logs: string[];

const writeRegistry = (repos: Record<string, unknown>) => {
  fs.writeFileSync(w.deps.registryPath, JSON.stringify({ repos }));
};
const item = (ns: string, key: string, k: string) =>
  JSON.parse(w.runner.items.get(`${ns}|${key}`)?.get(k) ?? '{}') as Record<
    string,
    unknown
  >;

beforeEach(() => {
  w = githubWorld();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  w.cleanup();
});

describe('every GitHub job', () => {
  it('skips when the gh config directory is missing', async () => {
    fs.rmSync(w.deps.configDir, { recursive: true });
    syncRepos(w.deps);
    await syncIssues(w.deps);
    buildRegistry(w.deps);
    pollCollabs([], w.deps);
    drainCollabs([], w.deps);
    watchNotifications(w.deps);
    expect(
      logs.filter((l) => l === '[skip] GitHub CLI config not configured'),
    ).toHaveLength(6);
    expect(w.ghCalls).toEqual([]);
  });
});

describe('syncRepos', () => {
  it('seeds unarchived repos, clones new ones and pulls existing clones', () => {
    writeRegistry({
      'acme/one': { defaultBranch: 'dev' },
      'acme/two': {},
      'acme/old': { isArchived: true },
    });
    fs.mkdirSync(path.join(w.dir, 'content', 'github', 'acme', 'two', 'repo'), {
      recursive: true,
    });
    syncRepos(w.deps);
    expect(logs).toContain('[repo-sync] seeding 2 repos');
    expect(w.runCalls[0]).toEqual(['gh', 'auth', 'switch', '-u', 'acme']);
    const clone = w.runCalls.find((c) => c[1] === 'clone');
    expect(clone).toContain('dev');
    expect(w.runCalls.some((c) => c.includes('reset'))).toBe(true);
    expect(item('github', 'repos-sync', 'acme/one')).toEqual({
      lastSyncedAt: GH_NOW,
      defaultBranch: 'dev',
    });
    expect(logs).toContain(
      '[repo-sync] end ' + GH_NOW + ' - batch 2/2, 0 errors',
    );
  });

  it('adds repos new to the registry and records a failed sync', () => {
    writeRegistry({ 'acme/one': {} });
    syncRepos(w.deps);
    writeRegistry({ 'acme/one': {}, 'acme/new': {} });
    const failing = githubWorld();
    w.deps.run = (cmd, args) => {
      if (
        args[0] === 'clone' &&
        args.includes('https://github.com/acme/new.git')
      )
        throw new Error('auth failed');
      return failing.deps.run(cmd, args);
    };
    syncRepos(w.deps);
    failing.cleanup();
    expect(logs).toContain('[repo-sync] adding new repo: acme/new');
    expect(item('github', 'repos-sync', 'acme/new')).toMatchObject({
      lastError: 'auth failed',
    });
    expect(BATCH_SIZE).toBe(15);
  });
});

describe('syncIssues', () => {
  const issue = (n: number, title = `t${String(n)}`) => ({
    number: n,
    title,
    state: 'OPEN',
    labels: [{ name: 'bug' }, 'p1'],
    assignees: [{ login: 'jane' }],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    url: `https://github.com/acme/one/issues/${String(n)}`,
  });

  it('stores issues with history, searches from the last sync and records errors', async () => {
    writeRegistry({ 'acme/one': {}, 'acme/bad': {} });
    let title = 'first';
    w = githubWorld((args) => {
      if (args.includes('acme/bad')) return new Error('search failed');
      return [issue(1, title)];
    });
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    fs.writeFileSync(
      w.deps.registryPath,
      JSON.stringify({ repos: { 'acme/one': {}, 'acme/bad': {} } }),
    );
    w.deps.run = () => {
      throw new Error('no such account');
    };
    await syncIssues(w.deps);
    expect(logs).toContain(
      '[issues-sync] warning: account switch failed: no such account',
    );
    const file = path.join(
      w.dir,
      'content',
      'github',
      'acme',
      'one',
      'issues',
      '1.json',
    );
    const first = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      current: Record<string, unknown>;
      meta: { version: number };
    };
    expect(first.current).toMatchObject({
      title: 'first',
      labels: ['bug', 'p1'],
      assignees: ['jane'],
      body: '',
      comments: 0,
    });
    expect(item('github', 'issues-sync', 'acme/bad')).toMatchObject({
      lastError: 'search failed',
    });

    title = 'second';
    await syncIssues(w.deps);
    const second = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      current: { title: string };
      history: unknown[];
      meta: { version: number };
    };
    expect(second.current.title).toBe('second');
    expect(second.history).toHaveLength(1);
    expect(second.meta.version).toBe(2);
    const search = w.ghCalls.filter((c) => c.includes('acme/one')).at(-1);
    expect(search).toContain('>=2026-04-01');
    expect(ISSUE_BATCH).toBe(10);
  });

  it('treats an empty result as no issues', async () => {
    writeRegistry({ 'acme/one': {} });
    w.deps.gh = () => ({ ok: true, status: 0, out: '[]', err: '' });
    await syncIssues(w.deps);
    expect(item('github', 'issues-sync', 'acme/one')).toEqual({
      lastSyncedAt: GH_NOW,
      issueCount: 0,
    });
  });
});

describe('githubJobDeps', () => {
  it('resolves the gh settings from config and sets GH_CONFIG_DIR', () => {
    const live = githubJobDeps();
    expect(process.env.GH_CONFIG_DIR).toBe(live.configDir);
    expect(path.basename(live.registryPath)).toMatch(/registry/);
    expect(live.now()).toMatch(/^\d{4}-/);
  });
});
