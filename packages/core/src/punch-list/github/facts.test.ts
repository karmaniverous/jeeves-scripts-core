import { describe, expect, it } from 'vitest';

import { fakeGitHub, issue, pr, release } from '../punch-list.test-helper.js';
import { gatherFacts, isDone, issuesLine, releasesLine } from './facts.js';

const repos = ['acme/s', 'k/server'];

describe('gatherFacts / isDone', () => {
  it('is Done when every issue is released or merged', () => {
    const port = fakeGitHub(
      {
        'acme/s': [issue(3, 'closed')],
        'k/server': [issue(41, 'closed'), issue(42, 'closed', 'not_planned')],
      },
      { 3: [pr(7, 'aaa')], 41: [pr(50, 'bbb')] },
      {
        'k/server': [
          { release: release('service/3.15.0'), shas: [] },
          { release: release('service/3.16.0'), shas: ['bbb'] },
        ],
      },
    );
    const facts = gatherFacts(port, 'acme-x', repos, 'acme/s');
    expect(facts.issues.map((f) => f.outcome)).toEqual([
      'merged-pr',
      'released',
      'not-planned',
    ]);
    expect(facts.issues[1]?.release?.tag_name).toBe('service/3.16.0');
    expect(isDone(facts)).toBe(true);
    expect(releasesLine(facts)).toBe(
      '- Releases: [s PR #7](https://github.com/pr/7) ([acme/s#3](https://github.com/r/3)) · [server service/3.16.0](https://github.com/rel/service/3.16.0) ([k/server#41](https://github.com/r/41))',
    );
  });

  it('is not Done while an issue is open or awaiting release, or when all are not planned', () => {
    const open = fakeGitHub({ 'acme/s': [issue(3, 'open')] }, {}, {});
    expect(isDone(gatherFacts(open, 'acme-x', repos, 'acme/s'))).toBe(false);
    const unreleased = fakeGitHub(
      { 'k/server': [issue(41, 'closed')] },
      { 41: [pr(50, 'bbb')] },
      {},
    );
    const f = gatherFacts(unreleased, 'acme-x', repos, 'acme/s');
    expect(f.issues[0]?.outcome).toBe('awaiting-release');
    expect(isDone(f)).toBe(false);
    const dropped = fakeGitHub(
      { 'acme/s': [issue(3, 'closed', 'not_planned')] },
      {},
      {},
    );
    expect(isDone(gatherFacts(dropped, 'acme-x', repos, 'acme/s'))).toBe(false);
  });

  it('reports a missing milestone and an empty one', () => {
    expect(
      issuesLine(
        gatherFacts(fakeGitHub({}, {}, {}), 'acme-x', repos, 'acme/s'),
      ),
    ).toBe('- Issues: milestone not found');
    expect(
      issuesLine(
        gatherFacts(
          fakeGitHub({ 'acme/s': [] }, {}, {}),
          'acme-x',
          repos,
          'acme/s',
        ),
      ),
    ).toBe('- Issues: none yet');
  });

  it('treats a completed issue without a merged PR as closed but not shipped, blocking Done', () => {
    const port = fakeGitHub(
      { 'acme/s': [issue(3, 'closed')] },
      { 3: [{ ...pr(7, 'a'), merged: false }] },
      {},
    );
    const facts = gatherFacts(port, 'acme-x', repos, 'acme/s');
    expect(facts.issues[0]?.outcome).toBe('no-pr');
    expect(issuesLine(facts)).toBe(
      '- Issues: [acme/s#3](https://github.com/r/3) closed (no linked PR)',
    );
    expect(isDone(facts)).toBe(false);
    const withShipped = fakeGitHub(
      { 'acme/s': [issue(3, 'closed'), issue(4, 'closed')] },
      { 3: [], 4: [pr(8, 'b')] },
      {},
    );
    expect(isDone(gatherFacts(withShipped, 'acme-x', repos, 'acme/s'))).toBe(
      false,
    );
  });
});
