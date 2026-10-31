import { beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({ gh: vi.fn() }));
vi.mock('../../lib/gh.js', () => core);

import { issue, release } from '../punch-list.test-helper.js';
import { liveGitHub } from './port.js';

/** Answer `gh api <endpoint>` (or graphql) from a table keyed by endpoint. */
const answer = (table: Record<string, unknown>): void => {
  core.gh.mockImplementation((args: string[]) => {
    const key = args[1] === 'graphql' ? 'graphql' : (args[1] ?? '');
    if (!(key in table))
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    return { out: JSON.stringify(table[key]) };
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('liveGitHub', () => {
  it('finds the milestone by title, lists its issues without PRs, and caches milestones', () => {
    answer({
      'repos/o/r/milestones?state=all&per_page=100': [
        { number: 1, title: 'acme-a' },
        { number: 2, title: 'acme-b' },
      ],
      'repos/o/r/issues?milestone=2&state=all&per_page=100': [
        issue(3, 'open'),
        { ...issue(4, 'closed'), pull_request: {} },
      ],
    });
    const gh = liveGitHub();
    expect(gh.milestoneIssues('o/r', 'acme-b')?.map((i) => i.number)).toEqual([
      3,
    ]);
    expect(gh.milestoneIssues('o/r', 'acme-x')).toBeUndefined();
    expect(
      core.gh.mock.calls.filter((c) => String(c[0]).includes('milestones')),
    ).toHaveLength(1);
  });

  it('reads closing PRs through GraphQL with the owner, name and number', () => {
    const nodes = [
      { number: 7, url: 'u', merged: true, mergeCommit: { oid: 'abc' } },
    ];
    answer({
      graphql: {
        data: {
          repository: { issue: { closedByPullRequestsReferences: { nodes } } },
        },
      },
    });
    expect(liveGitHub().closingPrs('o/r', 3)).toEqual(nodes);
    const args = core.gh.mock.calls[0]?.[0] as string[];
    expect(args).toEqual(
      expect.arrayContaining(['owner=o', 'name=r', 'number=3']),
    );
  });

  it('keeps published releases only, oldest first, and caches them', () => {
    answer({
      'repos/o/r/releases?per_page=100': [
        { ...release('2.0.0'), published_at: '2026-10-02T00:00:00Z' },
        { ...release('draft'), draft: true },
        { ...release('rc'), prerelease: true },
        { ...release('unpublished'), published_at: null },
        { ...release('1.0.0'), published_at: '2026-10-01T00:00:00Z' },
      ],
    });
    const gh = liveGitHub();
    expect(gh.releases('o/r').map((r) => r.tag_name)).toEqual([
      '1.0.0',
      '2.0.0',
    ]);
    gh.releases('o/r');
    expect(core.gh).toHaveBeenCalledTimes(1);
  });

  it('says a tag contains a commit when the commit is behind or identical', () => {
    const gh = liveGitHub();
    for (const [status, expected] of [
      ['behind', true],
      ['identical', true],
      ['ahead', false],
      ['diverged', false],
    ] as const) {
      answer({ 'repos/o/r/compare/service%2F1.0.0...abc': { status } });
      expect(gh.tagContains('o/r', 'service/1.0.0', 'abc')).toBe(expected);
    }
  });

  it('fails on a response that does not match the schema', () => {
    answer({ 'repos/o/r/releases?per_page=100': [{ nope: true }] });
    expect(() => liveGitHub().releases('o/r')).toThrow(
      /"path": \[\s*0,\s*"tag_name"\s*\]/,
    );
  });
});
