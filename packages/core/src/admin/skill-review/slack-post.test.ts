/**
 * Tests for the script-built Slack post: the "nothing applied" line, the
 * report link, continuous numbering across disposition sections, the
 * "Not yet reviewed" section (worker-marked, revised and newly created
 * proposals), the decided/snapshot notes, escaping of report prose, and
 * the proposal id on each line (shortened, unambiguous within the post).
 */

import { describe, expect, it } from 'vitest';

import type { Reconciled } from './reconcile.js';
import type { ValidReport } from './report.js';
import {
  buildReviewPost,
  postId,
  type ReviewedProposal,
} from './slack-post.js';

const REPORT: ValidReport = {
  entries: {
    'a-1': {
      disposition: 'Approve as is',
      shortDescription: 'Adds a logging step',
      recommendation: 'Apply as is',
    },
    'b-2': {
      disposition: 'Approve with modifications',
      shortDescription: 'Rewrites the setup section.',
      recommendation: 'Apply, but keep the old examples.',
    },
    'c-3': {
      disposition: 'Reject or decline',
      shortDescription: 'Duplicates skill d.',
      recommendation: 'Decline; d already covers this',
    },
    'd-4': {
      disposition: 'Not reviewed',
      shortDescription: 'Ran out of time',
      recommendation: 'Cover next run',
    },
  },
  counts: {
    'Approve as is': 1,
    'Approve with modifications': 1,
    'Reject or decline': 1,
    'Not reviewed': 1,
  },
};

const PROPOSALS: ReviewedProposal[] = [
  { id: 'a-1', skillName: 'logging-skill', kind: 'create' },
  { id: 'b-2', skillName: 'setup-skill', kind: 'update' },
  { id: 'c-3', skillName: 'dup-skill', kind: 'create' },
  { id: 'd-4', skillName: 'late-skill', kind: 'patch' },
];

const REPORT_LINK =
  '<https://server.example/browse/reports/skill-review/2026-10-20.md|Skill Workshop review \u2014 2026-10-20>';

const HEADER =
  '*This job applied nothing. Every proposal below is still pending, awaiting your decision.*';

const state = (over: Partial<Reconciled> = {}): Reconciled => ({
  current: PROPOSALS,
  revised: [],
  added: [],
  decided: 0,
  snapshot: false,
  ...over,
});

describe('buildReviewPost', () => {
  it('opens by saying nothing was applied, then links the report', () => {
    const post = buildReviewPost(REPORT, state(), REPORT_LINK, []);
    expect(post.split('\n').slice(0, 2)).toEqual([
      HEADER,
      `Report: ${REPORT_LINK}`,
    ]);
  });

  it('notes decided proposals and a snapshot-only post before the link', () => {
    const post = buildReviewPost(
      REPORT,
      state({ decided: 2, snapshot: true }),
      REPORT_LINK,
      [],
    );
    expect(post.split('\n').slice(0, 4)).toEqual([
      HEADER,
      "_Couldn't fully re-check the Workshop before posting; this reflects the review's snapshot._",
      '_2 reviewed proposal(s) decided since the review ran are omitted._',
      `Report: ${REPORT_LINK}`,
    ]);
  });

  it('throws when the report lacks an entry for a reviewed proposal', () => {
    const stray: ReviewedProposal = {
      id: 'z-9',
      skillName: 'stray',
      kind: 'create',
    };
    expect(() =>
      buildReviewPost(
        REPORT,
        state({ current: [...PROPOSALS, stray] }),
        REPORT_LINK,
        [],
      ),
    ).toThrow('The report has no entry for z-9');
  });

  it('groups by disposition with continuous numbering and the reply hint', () => {
    const post = buildReviewPost(REPORT, state(), REPORT_LINK, []);
    expect(post).toContain(
      [
        '*Approve as is*',
        '1. `logging-skill` (new, id `a-1`): Adds a logging step. Apply as is.',
        '',
        '*Approve with modifications*',
        '2. `setup-skill` (update, id `b-2`): Rewrites the setup section. Apply, but keep the old examples.',
        '',
        '*Reject or decline*',
        '3. `dup-skill` (new, id `c-3`): Duplicates skill d. Decline; d already covers this.',
        '',
        '*Not yet reviewed*',
        '4. `late-skill` (update, id `d-4`): Ran out of time. Cover next run.',
      ].join('\n'),
    );
    // One blank line before the hint, even with no budget lines between.
    expect(
      post.endsWith(
        'Cover next run.\n\nReply with something like "apply all recommendations except #5" to tell me what to do.',
      ),
    ).toBe(true);
  });

  it('adds no period after a question or an exclamation', () => {
    const report: ValidReport = {
      ...REPORT,
      entries: {
        ...REPORT.entries,
        'a-1': {
          disposition: 'Approve as is',
          shortDescription: 'Adds a logging step?',
          recommendation: 'Apply now!',
        },
      },
    };
    expect(buildReviewPost(report, state(), REPORT_LINK, [])).toContain(
      '1. `logging-skill` (new, id `a-1`): Adds a logging step? Apply now!\n',
    );
  });

  it('lists revised, then newly created proposals under "Not yet reviewed", continuing the numbering', () => {
    const post = buildReviewPost(
      REPORT,
      state({
        current: PROPOSALS.filter((p) => p.id !== 'b-2'),
        revised: [{ id: 'b-2', skillName: 'setup-skill', kind: 'update' }],
        added: [{ id: 'e-5', skillName: 'new-skill', kind: 'create' }],
      }),
      REPORT_LINK,
      [],
    );
    expect(post).not.toContain('*Approve with modifications*');
    expect(post).toContain(
      [
        '3. `late-skill` (update, id `d-4`): Ran out of time. Cover next run.',
        "4. `setup-skill` (update, id `b-2`): Revised after this review ran. The report's recommendation is for the earlier draft; it will be re-reviewed next run.",
        '5. `new-skill` (new, id `e-5`): Proposed after this review ran. Not yet reviewed; it will be covered next run.',
      ].join('\n'),
    );
  });

  it.each([
    ['a channel mention', '<!channel> look', '&lt;!channel&gt; look.'],
    ['a user mention', 'ask <@U123>', 'ask &lt;@U123&gt;.'],
    ['a link', 'see <http://x|y>', 'see &lt;http://x|y&gt;.'],
    ['an ampersand', 'A & B', 'A &amp; B.'],
  ])(
    'escapes %s in report prose, not in the report link',
    (_case, raw, shown) => {
      const report: ValidReport = {
        ...REPORT,
        entries: {
          ...REPORT.entries,
          'a-1': {
            disposition: 'Approve as is',
            shortDescription: raw,
            recommendation: raw,
          },
        },
      };
      const post = buildReviewPost(report, state(), REPORT_LINK, []);
      expect(post).toContain(
        `1. \`logging-skill\` (new, id \`a-1\`): ${shown} ${shown}`,
      );
      expect(post).toContain(`Report: ${REPORT_LINK}`);
    },
  );

  it('puts the catalog budget lines after the list, before the reply hint', () => {
    const post = buildReviewPost(REPORT, state(), REPORT_LINK, [
      '*Skills catalog budget:* b1',
      'b2',
    ]);
    expect(post).toContain(
      [
        '4. `late-skill` (update, id `d-4`): Ran out of time. Cover next run.',
        '',
        '*Skills catalog budget:* b1',
        'b2',
        '',
        'Reply with something like "apply all recommendations except #5" to tell me what to do.',
      ].join('\n'),
    );
  });

  it('tells two drafts of one skill apart by the id on each line', () => {
    const ids = [
      'setup-skill-20261103-7f3a9c01de',
      'setup-skill-20261103-7f3b',
    ];
    const entry = { disposition: 'Approve as is' as const };
    const report: ValidReport = {
      ...REPORT,
      entries: Object.fromEntries(
        ids.map((id) => [
          id,
          { ...entry, shortDescription: 'S', recommendation: 'R' },
        ]),
      ),
    };
    const current = ids.map((id) => ({
      id,
      skillName: 'setup-skill',
      kind: 'update',
    }));
    const post = buildReviewPost(report, state({ current }), REPORT_LINK, []);
    expect(post).toContain(
      [
        '1. `setup-skill` (update, id `setup-skill-20261103-7f3a`): S. R.',
        '2. `setup-skill` (update, id `setup-skill-20261103-7f3b`): S. R.',
      ].join('\n'),
    );
  });

  it.each([
    ['a short id whole', 'a-1', ['a-1', 'b-2'], 'a-1'],
    [
      'the first 8 chars of a long one',
      'abcdefghij',
      ['abcdefghij', 'x'],
      'abcdefgh',
    ],
    ['an id alone in the post', 'abcdefghij', ['abcdefghij'], 'abcdefgh'],
    [
      'until no other id shares it',
      'abcdefghij',
      ['abcdefghij', 'abcdefgxyz', 'abcdefghiz'],
      'abcdefghij',
    ],
    [
      'a whole id that starts another',
      'abcdefgh',
      ['abcdefgh', 'abcdefghij'],
      'abcdefgh',
    ],
    [
      'the longer of two such ids',
      'abcdefghij',
      ['abcdefgh', 'abcdefghij'],
      'abcdefghi',
    ],
  ])('shows %s', (_case, id, ids, shown) => {
    expect(postId(id, ids)).toBe(shown);
  });

  it('omits empty sections', () => {
    const onlyA = REPORT.entries['a-1'];
    const onlyProposal = PROPOSALS[0];
    if (!onlyA || !onlyProposal) throw new Error('fixture missing a-1');
    const report: ValidReport = {
      entries: { 'a-1': onlyA },
      counts: {
        'Approve as is': 1,
        'Approve with modifications': 0,
        'Reject or decline': 0,
        'Not reviewed': 0,
      },
    };
    const post = buildReviewPost(
      report,
      state({ current: [onlyProposal] }),
      REPORT_LINK,
      [],
    );
    expect(post).not.toContain('*Approve with modifications*');
    expect(post).not.toContain('*Reject or decline*');
    expect(post).not.toContain('*Not yet reviewed*');
  });
});
