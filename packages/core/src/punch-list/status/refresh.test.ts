import { describe, expect, it } from 'vitest';

import type { MilestoneFacts } from '../github/facts.js';
import type { InstallCheck } from '../github/install.js';
import {
  emptyPunchList,
  type Milestone,
  type PunchList,
} from '../model/types.js';
import { issue, pr } from '../punch-list.test-helper.js';
import {
  anyTransitions,
  type MilestoneUpdate,
  refreshMilestones,
} from './refresh.js';

const block = (slug: string): Milestone => ({
  slug,
  title: slug,
  body: ['Steps.'],
  status: [],
});

const facts = (slug: string, state: 'open' | 'closed'): MilestoneFacts => ({
  slug,
  found: true,
  issues: [
    state === 'open'
      ? { repo: 'acme/s', issue: issue(3, 'open'), outcome: 'open' }
      : {
          repo: 'acme/s',
          issue: issue(3, 'closed'),
          outcome: 'merged-pr',
          pr: pr(7, 'abc'),
        },
  ],
});

const installed = (ok: boolean): InstallCheck[] => [
  { label: 's PR #7', state: ok ? 'installed' : 'pending' },
];

const update = (
  slug: string,
  state: 'open' | 'closed',
  ok = false,
): [string, MilestoneUpdate] => [
  slug,
  { facts: facts(slug, state), install: installed(ok) },
];

const list = (over: Partial<PunchList>): PunchList => ({
  ...emptyPunchList('2026-10-18'),
  ...over,
});

describe('refreshMilestones', () => {
  it('leaves milestones without an update untouched', () => {
    const l = list({
      todo: [block('acme-a')],
      done: [{ ...block('acme-b'), integrated: false }],
    });
    const r = refreshMilestones(l, new Map());
    expect(r.list).toEqual(l);
    expect(anyTransitions(r.transitions)).toBe(false);
  });

  it('keeps an unfinished TODO milestone in TODO with only its Issues line', () => {
    const r = refreshMilestones(
      list({ todo: [block('acme-a')] }),
      new Map([update('acme-a', 'open')]),
    );
    expect(r.list.todo[0]?.status).toEqual([
      '- Issues: [acme/s#3](https://github.com/r/3) open',
    ]);
    expect(anyTransitions(r.transitions)).toBe(false);
  });

  it('moves a finished milestone to Done, unticked, with its releases; installed in the same run', () => {
    const r = refreshMilestones(
      list({ todo: [block('acme-a')] }),
      new Map([update('acme-a', 'closed', true)]),
    );
    expect(r.list.todo).toEqual([]);
    expect(r.list.done[0]).toMatchObject({
      slug: 'acme-a',
      integrated: false,
      body: ['Steps.'],
    });
    expect(r.list.done[0]?.status).toHaveLength(3);
    expect(r.transitions.done).toEqual([
      {
        slug: 'acme-a',
        releases:
          '[s PR #7](https://github.com/pr/7) ([acme/s#3](https://github.com/r/3))',
      },
    ]);
    expect(r.transitions.installed).toEqual(['acme-a']);
  });

  it('reports installed only on the run it flips', () => {
    const pending = refreshMilestones(
      list({ todo: [block('acme-a')] }),
      new Map([update('acme-a', 'closed')]),
    ).list;
    const flipped = refreshMilestones(
      pending,
      new Map([update('acme-a', 'closed', true)]),
    );
    expect(flipped.transitions.installed).toEqual(['acme-a']);
    const again = refreshMilestones(
      flipped.list,
      new Map([update('acme-a', 'closed', true)]),
    );
    expect(anyTransitions(again.transitions)).toBe(false);
  });

  it('moves a Done milestone back to TODO, dropping the Done checkbox and release lines', () => {
    const l = list({
      done: [
        { ...block('acme-a'), status: ['- Releases: x'], integrated: false },
      ],
    });
    const r = refreshMilestones(l, new Map([update('acme-a', 'open')]));
    expect(r.list.done).toEqual([]);
    expect(r.list.todo[0]).toEqual({
      ...block('acme-a'),
      status: ['- Issues: [acme/s#3](https://github.com/r/3) open'],
    });
    expect(r.transitions.reopened).toEqual(['acme-a']);
  });
});
