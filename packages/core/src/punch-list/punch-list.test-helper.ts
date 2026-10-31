/**
 * @module punch-list/punch-list.test-helper
 *
 * Test-only fixtures shared by the punch-list tests: a sample list,
 * builders for GitHub records and harvest report items, and a fake
 * GitHub port. Not used by production code.
 */

import { readFileSync } from 'node:fs';

import type { PunchListConfig } from './config.js';
import type { ClosingPr, GitHubPort, Issue, Release } from './github/port.js';
import type { ReportItem } from './harvest/report.js';
import { emptyPunchList, type PunchList } from './model/types.js';

export const first = <T>(items: T[]): T => {
  const [item] = items;
  if (item === undefined) throw new Error('empty');
  return item;
};

export const samplePunchList: PunchList = {
  ...emptyPunchList('2026-10-18'),
  tasks: [
    {
      id: 't-0000000a',
      checked: false,
      text: '**Revoke the leaked PAT** — rotate it · added 2026-10-18',
    },
  ],
  backlog: [
    {
      id: 'b-0000000b',
      checked: false,
      text: '**Dropbox support** — files live there · requested by Pat Example · [acme/jeeves-scripts-acme#2](https://github.com/acme/jeeves-scripts-acme/issues/2) · added 2026-10-17',
    },
  ],
  todo: [
    {
      slug: 'acme-punch-list',
      title: 'Instance punch list',
      body: ['Spec and jobs.', '', 'Integration: register both jobs.'],
      status: ['- Issues: [acme/jeeves-scripts-acme#3](https://x) open'],
    },
  ],
  done: [
    {
      slug: 'acme-dropbox',
      title: 'Dropbox',
      body: [],
      status: [
        '- Issues: a',
        '- Releases: b',
        '- Installed: ⏳ awaiting operator update',
      ],
      integrated: false,
    },
  ],
  integrated: [
    {
      slug: 'acme-old',
      title: 'Old',
      body: ['x'],
      status: [],
      integrated: true,
      integratedOn: '2026-09-01',
    },
  ],
  completedTasks: [
    {
      id: 't-0000000c',
      checked: true,
      text: '**Old task** — added 2026-09-01 · done 2026-09-10',
    },
  ],
  processedBacklog: [
    {
      id: 'b-0000000d',
      checked: true,
      text: '**Idea** — x → acme-punch-list · added 2026-10-01 · processed 2026-10-18',
    },
  ],
};

export const issue = (
  number: number,
  state: 'open' | 'closed',
  reason: string | null = 'completed',
): Issue => ({
  number,
  html_url: `https://github.com/r/${String(number)}`,
  title: `Issue ${String(number)}`,
  state,
  state_reason: reason,
});
export const pr = (number: number, sha: string): ClosingPr => ({
  number,
  url: `https://github.com/pr/${String(number)}`,
  merged: true,
  mergeCommit: { oid: sha },
});
export const release = (tag: string): Release => ({
  tag_name: tag,
  html_url: `https://github.com/rel/${tag}`,
  draft: false,
  prerelease: false,
  published_at: '2026-10-20T00:00:00Z',
});

/** A fake GitHub: milestone issues per repo, closing PRs per issue, releases containing shas. */
export const fakeGitHub = (
  issues: Record<string, Issue[]>,
  prs: Record<number, ClosingPr[]>,
  releases: Record<string, { release: Release; shas: string[] }[]>,
): GitHubPort => ({
  milestoneIssues: (repo) => issues[repo],
  closingPrs: (_, n) => prs[n] ?? [],
  releases: (repo) => (releases[repo] ?? []).map((r) => r.release),
  tagContains: (repo, tag, sha) =>
    (releases[repo] ?? []).some(
      (r) => r.release.tag_name === tag && r.shas.includes(sha),
    ),
});

export const reportItem = (over: Partial<ReportItem> = {}): ReportItem => ({
  title: 'Ignore .meta lock files',
  why: 'The watcher logs ENOENT for deleted lock files.',
  kind: 'inferred',
  sources: ['watcher:/base/content/.meta/.lock'],
  ...over,
});

/** A resolved `punchList` config for tests; `overrides` win. */
export const testConfig = (
  overrides: Partial<PunchListConfig> = {},
): PunchListConfig => ({
  dir: '/base/content/punch-list',
  timeZone: 'Asia/Tokyo',
  retentionDays: 30,
  slack: { channel: 'C000PUNCH01', account: 'default' },
  scriptsRepo: {
    repo: 'acme/jeeves-scripts-acme',
    clone: '/base/jeeves-scripts',
  },
  installMap: {},
  lockFile: '/base/state/punch-list/punch-list.lock',
  pendingFile: '/base/state/punch-list/status-pending.json',
  cursorFile: '/base/state/punch-list/harvest-cursor.json',
  inboxDir: '/base/state/punch-list/inbox',
  inputRoots: ['/base/content/email'],
  serverConfig: '/base/config/jeeves-server/config.json',
  ...overrides,
});

/** A runnable's entry in core's `jobs/punch-list.json`. */
export const punchListManifest = (id: string): unknown =>
  (
    JSON.parse(
      readFileSync(
        new URL('../../jobs/punch-list.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, unknown>
  )[id];
