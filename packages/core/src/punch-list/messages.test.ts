import { describe, expect, it } from 'vitest';

import {
  attribution,
  harvestMessage,
  quickLinksText,
  slackLink,
  transitionMessage,
} from './messages.js';
import { reportItem } from './punch-list.test-helper.js';

describe('slackLink / attribution', () => {
  it('links when there is a URL, else shows the label', () => {
    expect(slackLink('https://x', 'open')).toBe('<https://x|open>');
    expect(slackLink(undefined, 'open')).toBe('open');
  });

  it('attributes requested and inferred items', () => {
    expect(attribution({ kind: 'requested', requester: 'Ana' })).toBe(
      'requested by Ana',
    );
    expect(attribution({ kind: 'inferred' })).toBe('inferred');
  });
});

describe('transitionMessage', () => {
  it('lists each transition under a linked header', () => {
    expect(
      transitionMessage(
        {
          done: [{ slug: 'acme-a', releases: 'R' }],
          installed: ['acme-b'],
          reopened: ['acme-c'],
        },
        'https://f',
      ),
    ).toBe(
      [
        '*<https://f|Punch list> update*',
        '• `acme-a` is *Done*: R',
        '• `acme-b` is installed ✅ (ready to integrate)',
        '• `acme-c` is back in *TODO* (an issue was reopened or is awaiting release)',
      ].join('\n'),
    );
  });
});

describe('harvestMessage', () => {
  it('lists added items with attribution and the summary', () => {
    const added = [
      reportItem(),
      reportItem({ title: 'B', kind: 'requested', requester: 'Pat' }),
    ];
    expect(harvestMessage(added, 'Two needs.', undefined)).toBe(
      [
        "*Punch list harvest:* 2 new backlog item(s) in today's punch list",
        '• Ignore .meta lock files (inferred)',
        '• B (requested by Pat)',
        '_Two needs._',
      ].join('\n'),
    );
  });

  it('omits an empty summary', () => {
    expect(
      harvestMessage([reportItem()], '', 'https://f').split('\n'),
    ).toHaveLength(2);
  });
});

describe('quickLinksText', () => {
  it('links today and the spec, or says the file is not written yet', () => {
    expect(quickLinksText('2026-10-18', 'https://t', 'https://s')).toContain(
      "• Today's punch list (2026-10-18): <https://t|open>\n• Spec: <https://s|punch-list-spec.md>",
    );
    expect(quickLinksText('2026-10-18', undefined, undefined)).toContain(
      'not yet written',
    );
  });
});
