/**
 * Edge cases of the GitHub collaborator poll and drain and the
 * notification watch: paging, empty replies, failure messages, the 96-hour
 * review alert and web-URL fallbacks.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainCollabs } from './drain-collabs.js';
import {
  type GitHubWorld,
  githubWorld,
} from './lib/github-deps.test-helper.js';
import { pollCollabs } from './poll-collabs.js';
import { watchNotifications } from './watch.js';

let w: GitHubWorld | undefined;
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  w?.cleanup();
});

describe('pollCollabs paging', () => {
  it('follows full pages of repos and invitations to the next page', () => {
    const repos = Array.from({ length: 100 }, (_, i) => ({
      full_name: `acme/r${String(i)}`,
      updated_at: '2026-01-01',
      archived: false,
    }));
    const invites = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      repository: { full_name: `x/y${String(i)}` },
    }));
    w = githubWorld((args) => {
      const endpoint = args[3] ?? '';
      const page = /[?&]page=(\d+)/.exec(endpoint)?.[1];
      if (endpoint.startsWith('/user/repos?')) return page === '1' ? repos : '';
      if (endpoint.startsWith('/user/repository_invitations'))
        return page === '1' ? invites : [];
      return undefined;
    });
    pollCollabs([], w.deps);
    const pages = w.ghCalls
      .filter((c) => c[0] === 'api')
      .map((c) => /[?&]page=(\d+)/.exec(c[3] ?? '')?.[1]);
    expect(pages).toEqual(['1', '2', '1', '2']);
    expect(w.runner.queues.get('gh-collabs')).toHaveLength(200);
  });
});

describe('drainCollabs failures', () => {
  it('fails an invite whose accept fails, with gh output or a fallback message', () => {
    let n = 0;
    w = githubWorld();
    w.deps.gh = (args) => {
      if (args[0] === 'auth') return { ok: true, status: 0, out: '', err: '' };
      n++;
      return n === 1
        ? { ok: false, status: 1, out: 'Not Found', err: '' }
        : { ok: false, status: 1, out: '', err: '' };
    };
    w.runner.client.enqueue('gh-collabs', { kind: 'invite', id: 1 });
    w.runner.client.enqueue('gh-collabs', {
      kind: 'repo',
      full_name: 'acme/a',
    });
    drainCollabs([], w.deps);
    expect(
      (w.runner.queues.get('gh-collabs') ?? []).map((i) => i.error),
    ).toEqual(['Not Found', 'unknown error']);
  });
});

describe('watchNotifications edges', () => {
  it('raises the 96-hour review alert once, links issues, and falls back without a repo URL', () => {
    const now = Date.parse('2026-04-01T12:00:00.000Z');
    const notes = [
      {
        id: 'r1',
        updated_at: new Date(now - 100 * 36e5).toISOString(),
        unread: true,
        reason: 'review_requested',
        subject: {
          title: 'PR',
          type: 'PullRequest',
          url: 'https://api.github.com/repos/acme/a/pulls/7',
        },
        repository: {
          full_name: 'acme/a',
          html_url: 'https://github.com/acme/a',
        },
      },
      {
        id: 'i1',
        updated_at: 'not a date',
        unread: true,
        reason: 'team_mention',
        subject: {
          title: 'Bug',
          type: 'Issue',
          url: 'https://api.github.com/repos/acme/a/issues/3',
        },
        repository: {
          full_name: 'acme/a',
          html_url: 'https://github.com/acme/a',
        },
      },
      {
        id: 'x1',
        updated_at: new Date(now).toISOString(),
        unread: true,
        reason: 'mention',
        subject: {
          title: 'Odd',
          type: 'Discussion',
          url: 'https://api.github.com/x',
        },
      },
    ];
    w = githubWorld((args) =>
      args[0] === 'api' && w?.ghCalls.at(-2)?.[3] === 'acme' ? notes : [],
    );
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
      alerts: { reason: string; line: string }[];
    };
    const reasons = report.alerts.map((a) => a.reason);
    expect(reasons).toContain('review_requested_48h');
    expect(
      report.alerts.find((a) => a.reason === 'team_mention')?.line,
    ).toContain('https://github.com/acme/a/issues/3');
    expect(report.alerts.find((a) => a.reason === 'mention')?.line).toContain(
      'https://api.github.com/x',
    );
    out = '';
    watchNotifications(w.deps);
    expect(
      (JSON.parse(out) as { alerts: { reason: string }[] }).alerts.map(
        (a) => a.reason,
      ),
    ).toEqual(['review_requested_96h']);
  });
});
