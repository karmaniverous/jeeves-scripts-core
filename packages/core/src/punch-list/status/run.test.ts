import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GitHubPort } from '../github/port.js';
import { parsePunchList } from '../model/parse.js';
import { renderPunchList } from '../model/render.js';
import {
  emptyPunchList,
  type Milestone,
  type PunchList,
} from '../model/types.js';
import { testConfig } from '../punch-list.test-helper.js';
import { dayFile } from '../store.js';
import { runStatus, type StatusDeps } from './run.js';

const closed = {
  number: 3,
  html_url: 'https://gh/3',
  title: 'x',
  state: 'closed' as const,
  state_reason: 'completed',
};
const github = (state: 'open' | 'closed'): GitHubPort => ({
  milestoneIssues: (repo) =>
    repo === 'acme/jeeves-scripts-acme' ? [{ ...closed, state }] : undefined,
  closingPrs: () => [
    {
      number: 7,
      url: 'https://gh/pr/7',
      merged: true,
      mergeCommit: { oid: 'abc' },
    },
  ],
  releases: () => [],
  tagContains: () => false,
});

const setup = (list: PunchList) => {
  const dir = mkdtempSync(join(tmpdir(), 'pl-status-'));
  const serverConfig = join(dir, 'server.json');
  writeFileSync(
    serverConfig,
    JSON.stringify({
      publicUrl: 'https://jeeves.example.com',
      roots: { t: dir },
    }),
  );
  writeFileSync(dayFile(dir, list.date), renderPunchList(list));
  const config = testConfig({
    dir,
    serverConfig,
    timeZone: 'UTC',
    lockFile: join(dir, 'state', 'pl.lock'),
    pendingFile: join(dir, 'state', 'pending.json'),
  });
  const posts: string[] = [];
  const logs: string[] = [];
  const deps = (
    state: 'open' | 'closed',
    inHead = false,
    slackDown = false,
  ): StatusDeps => ({
    github: github(state),
    install: { versionsAt: () => [], inHead: () => inHead },
    slack: () => ({
      post: (_c, text) => {
        if (slackDown) return Promise.reject(new Error('slack down'));
        posts.push(text);
        return Promise.resolve();
      },
      update: () => Promise.resolve(),
    }),
    now: () => new Date('2026-10-18T12:00:00Z'),
    log: (m) => logs.push(m),
  });
  const read = (): PunchList =>
    parsePunchList(readFileSync(dayFile(dir, list.date), 'utf8'));
  return { config, deps, posts, logs, read };
};

const firstTodo: Milestone = {
  slug: 'acme-punch-list',
  title: 'Punch list',
  body: ['Steps.'],
  status: [],
};

const base: PunchList = {
  ...emptyPunchList('2026-10-18'),
  todo: [
    {
      slug: 'acme-punch-list',
      title: 'Punch list',
      body: ['Steps.'],
      status: [],
    },
  ],
};

describe('runStatus', () => {
  it('annotates an open milestone and posts nothing', async () => {
    const s = setup(base);
    await runStatus(s.config, { live: true }, s.deps('open'));
    expect(s.read().todo[0]?.status).toEqual([
      '- Issues: [acme/jeeves-scripts-acme#3](https://gh/3) open',
    ]);
    expect(s.posts).toEqual([]);
  });

  it('moves a finished milestone to Done and posts, then posts once when installed', async () => {
    const s = setup(base);
    await runStatus(s.config, { live: true }, s.deps('closed'));
    const done = s.read().done[0] ?? firstTodo;
    expect(done).toMatchObject({
      slug: 'acme-punch-list',
      integrated: false,
      body: ['Steps.'],
    });
    expect(done.status[2]).toMatch(/^- Installed: ⏳/);
    expect(s.posts[0]).toContain(
      '`acme-punch-list` is *Done*: [jeeves-scripts-acme PR #7](https://gh/pr/7)',
    );
    expect(s.posts[0]).toContain(
      '<https://jeeves.example.com/browse/t/2026-10-18.md|Punch list>',
    );

    const [first] = s.posts;
    await runStatus(s.config, { live: true }, s.deps('closed'));
    expect(s.posts).toEqual([first]);
    await runStatus(s.config, { live: true }, s.deps('closed', true));
    expect(s.read().done[0]?.status[2]).toBe('- Installed: ✅');
    expect(s.posts[1]).toContain('`acme-punch-list` is installed ✅');
  });

  it('moves a reopened milestone back to TODO', async () => {
    const s = setup({
      ...base,
      todo: [],
      done: [{ ...firstTodo, status: [], integrated: false }],
    });
    await runStatus(s.config, { live: true }, s.deps('open'));
    expect(s.read().todo[0]?.slug).toBe('acme-punch-list');
    expect(s.posts[0]).toContain('back in *TODO*');
  });

  it('sends an unticked Integrated milestone back to Done and refreshes it in the same run', async () => {
    const s = setup({
      ...base,
      todo: [],
      integrated: [
        {
          ...firstTodo,
          status: [],
          integrated: false,
          integratedOn: '2026-10-01',
        },
      ],
    });
    await runStatus(s.config, { live: true }, s.deps('closed'));
    const done = s.read().done[0] ?? firstTodo;
    expect(done).toMatchObject({ slug: 'acme-punch-list', integrated: false });
    expect(done.status[1]).toMatch(
      /^- Releases: \[jeeves-scripts-acme PR #7\]/,
    );
  });

  it('applies a ticked Done box', async () => {
    const s = setup({
      ...base,
      todo: [],
      done: [{ ...firstTodo, status: [], integrated: true }],
    });
    await runStatus(s.config, { live: true }, s.deps('closed'));
    expect(s.read().integrated[0]).toMatchObject({
      slug: 'acme-punch-list',
      integratedOn: '2026-10-18',
    });
  });

  it('retries a transition whose post failed on the next run', async () => {
    const s = setup(base);
    await expect(
      runStatus(s.config, { live: true }, s.deps('closed', false, true)),
    ).rejects.toThrow('slack down');
    expect(s.read().done[0]?.slug).toBe('acme-punch-list');
    await runStatus(s.config, { live: true }, s.deps('closed'));
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]).toContain('is *Done*');
    expect(s.logs).toContain('retrying 1 unposted notification(s)');
  });

  it('writes and posts nothing in a dry run', async () => {
    const s = setup(base);
    const before = renderPunchList(s.read());
    await runStatus(s.config, { live: false }, s.deps('closed'));
    expect(renderPunchList(s.read())).toBe(before);
    expect(s.posts).toEqual([]);
    expect(s.logs.some((l) => l.startsWith('[dry-run] would post'))).toBe(true);
  });
});

describe('runStatus logging and scope', () => {
  it('logs the file only in a dry run', async () => {
    const live = setup(base);
    await runStatus(live.config, { live: true }, live.deps('open'));
    expect(live.logs.some((l) => l.startsWith('# Punch List'))).toBe(false);
    const dry = setup(base);
    await runStatus(dry.config, { live: false }, dry.deps('open'));
    expect(dry.logs.some((l) => l.startsWith('# Punch List'))).toBe(true);
  });

  it('checks Integrated milestones only when they are sent back', async () => {
    const s = setup({
      ...base,
      integrated: [
        {
          slug: 'acme-old',
          title: 'Old',
          body: [],
          status: [],
          integrated: true,
          integratedOn: '2026-10-01',
        },
      ],
    });
    await runStatus(s.config, { live: true }, s.deps('open'));
    expect(s.logs[0]).toBe('2026-10-18: 1 milestone(s) checked; file written');
  });
});
