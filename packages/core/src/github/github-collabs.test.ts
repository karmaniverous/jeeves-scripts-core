/**
 * Tests for the GitHub registry build, the collaborator poll and drain and
 * the notification watch, with a scripted `gh` and the in-memory runner.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRegistry } from './build-registry.js';
import { drainCollabs } from './drain-collabs.js';
import {
  GH_NOW,
  type GitHubWorld,
  githubWorld,
} from './lib/github-deps.test-helper.js';
import { pollCollabs } from './poll-collabs.js';
import { watchNotifications } from './watch.js';

let w: GitHubWorld;
let logs: string[];

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

describe('buildRegistry', () => {
  const repo = (full: string, over: Record<string, unknown> = {}) => {
    const [owner = ''] = full.split('/');
    return {
      full_name: full,
      owner: { login: owner },
      name: full.split('/')[1],
      private: true,
      archived: false,
      disabled: false,
      fork: false,
      default_branch: 'main',
      description: null,
      homepage: null,
      topics: [],
      language: 'TypeScript',
      license: { spdx_id: 'MIT' },
      pushed_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      has_issues: true,
      has_wiki: false,
      open_issues_count: 2,
      visibility: 'private',
      permissions: { push: true },
      ...over,
    };
  };

  it('needs the gh account', () => {
    w.deps.account = '';
    buildRegistry(w.deps);
    expect(logs).toContain(
      '[skip] integrations.gh.account is not set in jeeves-scripts.json',
    );
  });

  it('writes push-access repos plus external scopes with a social-use policy', () => {
    fs.writeFileSync(
      w.deps.registryPath,
      JSON.stringify({
        scopes: {
          partner: { external: true },
          broken: { external: true },
          mine: { external: false },
        },
      }),
    );
    w = githubWorld((args) => {
      const endpoint = args[1] ?? '';
      if (
        endpoint.startsWith('/user/repos?') &&
        /[?&]page=1(&|$)/.test(endpoint)
      )
        return [
          repo('acme/a'),
          repo('other/b'),
          repo('acme/pub', { private: false }),
          repo('acme/ro', { permissions: { push: false } }),
          repo('acme/arch', { archived: true }),
        ];
      if (endpoint.startsWith('/orgs/partner'))
        return [repo('partner/x'), repo('acme/a')];
      if (endpoint.startsWith('/orgs/broken')) return new Error('404');
      return [];
    });
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    fs.writeFileSync(
      w.deps.registryPath,
      JSON.stringify({
        scopes: {
          partner: { external: true },
          broken: { external: true },
          mine: { external: false },
        },
      }),
    );
    buildRegistry(w.deps);
    const reg = JSON.parse(fs.readFileSync(w.deps.registryPath, 'utf8')) as {
      scopes: Record<string, unknown>;
      generatedAt: string;
      repos: Record<string, { socialUse: string }>;
    };
    expect(Object.keys(reg.repos).sort()).toEqual([
      'acme/a',
      'acme/pub',
      'other/b',
      'partner/x',
    ]);
    expect(reg.repos['acme/a']?.socialUse).toBe('caution');
    expect(reg.repos['acme/pub']?.socialUse).toBe('ok');
    expect(reg.repos['other/b']?.socialUse).toBe('restricted');
    expect(reg.generatedAt).toBe(GH_NOW);
    expect(Object.keys(reg.scopes)).toEqual(['partner', 'broken', 'mine']);
    expect(logs).toContain('[repo-registry] external scope partner: 2 repos');
    expect(
      logs.some((l) =>
        l.startsWith('[repo-registry] external scope broken: fetch failed'),
      ),
    ).toBe(true);
  });
});

describe('pollCollabs', () => {
  it('queues repos updated since the last poll and pending invitations', () => {
    w.runner.client.setState(
      'gh-collabs',
      'poll-state',
      JSON.stringify({ lastRepoUpdatedAt: '2026-01-02' }),
    );
    w = githubWorld((args) => {
      const endpoint = args[3] ?? '';
      if (
        endpoint.startsWith('/user/repos?') &&
        /[?&]page=1(&|$)/.test(endpoint)
      )
        return [
          { full_name: 'acme/new', updated_at: '2026-01-05', archived: false },
          { full_name: 'acme/arch', updated_at: '2026-01-04', archived: true },
          { full_name: 'acme/old', updated_at: '2026-01-01', archived: false },
        ];
      if (
        endpoint.startsWith('/user/repository_invitations') &&
        /[?&]page=1(&|$)/.test(endpoint)
      )
        return [
          { id: 7, repository: { full_name: 'x/y' } },
          { repository: {} },
        ];
      return [];
    });
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    w.runner.client.setState(
      'gh-collabs',
      'poll-state',
      JSON.stringify({ lastRepoUpdatedAt: '2026-01-02' }),
    );
    pollCollabs(['--owner', 'me', '--botUser', 'bot'], w.deps);
    const q = (w.runner.queues.get('gh-collabs') ?? []).map((i) => i.payload);
    expect(q).toEqual([
      { kind: 'repo', full_name: 'acme/new', permission: 'push', ts: GH_NOW },
      { kind: 'invite', id: 7, repo: 'x/y', ts: GH_NOW },
    ]);
    expect(w.ghCalls[0]).toEqual(['auth', 'switch', '-u', 'me']);
    expect(w.ghCalls.some((c) => c.join(' ') === 'auth switch -u bot')).toBe(
      true,
    );
    expect(
      JSON.parse(w.runner.client.getState('gh-collabs', 'poll-state') ?? '{}'),
    ).toEqual({ lastRepoUpdatedAt: '2026-01-05' });
    expect(logs).toContain('[poll-collabs] queued 2 items');
  });
});

describe('drainCollabs', () => {
  it('adds the bot to repos, accepts invites and fails items whose call fails', () => {
    w = githubWorld((args) =>
      args.includes('repos/acme/bad/collaborators/acme-bot')
        ? new Error('forbidden')
        : {},
    );
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    const r = w.runner.client;
    r.enqueue('gh-collabs', { kind: 'repo', full_name: 'acme/a' });
    r.enqueue('gh-collabs', { kind: 'invite', id: 9 });
    r.enqueue('gh-collabs', {
      kind: 'repo',
      full_name: 'acme/bad',
      permission: 'admin',
    });
    r.enqueue('gh-collabs', { kind: 'other' });
    drainCollabs(['--maxItems', '10'], w.deps);
    const q = w.runner.queues.get('gh-collabs') ?? [];
    expect(q.map((i) => i.status)).toEqual(['done', 'done', 'failed', 'done']);
    expect(q[2]?.error).toBe('forbidden');
    expect(w.ghCalls).toContainEqual([
      'api',
      '-X',
      'PATCH',
      'user/repository_invitations/9',
    ]);
    expect(w.ghCalls).toContainEqual([
      'api',
      '-X',
      'PUT',
      'repos/acme/a/collaborators/acme-bot',
      '-f',
      'permission=push',
    ]);
    expect(logs).toContain('[drain-collabs] processed 4 items');
  });
});

describe('watchNotifications', () => {
  const notif = (
    id: string,
    reason: string,
    updatedAt: string,
    unread = true,
  ) => ({
    id,
    updated_at: updatedAt,
    unread,
    reason,
    subject: {
      title: `T${id}`,
      type: 'PullRequest',
      url: `https://api.github.com/repos/acme/a/pulls/${id}`,
    },
    repository: { full_name: 'acme/a', html_url: 'https://github.com/acme/a' },
  });

  it('escalates new important notifications, flags stale review requests and alerts on API failure', () => {
    w = githubWorld((args) => {
      if (args[0] === 'auth') return undefined;
      return w.ghCalls.filter((c) => c[0] === 'auth').at(-1)?.[3] === 'acme-bot'
        ? new Error('bad credentials')
        : [
            notif('1', 'mention', GH_NOW),
            notif('2', 'review_requested', '2026-03-29T00:00:00.000Z'),
            notif('3', 'subscribed', GH_NOW),
          ];
    });
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(
      (s: string | Uint8Array) => {
        out += String(s);
        return true;
      },
    );
    fs.mkdirSync(path.join(w.deps.githubDir, 'watch'), { recursive: true });
    watchNotifications(w.deps);
    const report = JSON.parse(out) as {
      perUser: Record<
        string,
        { fetched: number; importantNew: number; error?: string }
      >;
      alerts: { type: string; reason: string; line: string }[];
    };
    expect(report.perUser.acme).toEqual({ fetched: 3, importantNew: 2 });
    expect(report.perUser['acme-bot']?.error).toBe('bad credentials');
    expect(report.alerts.map((a) => a.reason).sort()).toEqual(
      [
        'mention',
        'notifications_api_failed',
        'review_requested',
        'review_requested_48h',
      ].sort(),
    );
    expect(report.alerts.find((a) => a.reason === 'mention')?.line).toContain(
      'https://github.com/acme/a/pull/1',
    );
    expect(w.runner.queues.get('github-escalations')).toHaveLength(2);
    expect(
      fs.readFileSync(path.join(w.deps.githubDir, 'watch', 'log.md'), 'utf8'),
    ).toContain('fetched: acme-bot=0, acme=3; alerts: 4');

    out = '';
    watchNotifications(w.deps);
    const again = JSON.parse(out) as { alerts: unknown[] };
    expect(again.alerts).toEqual([]);
  });
});
