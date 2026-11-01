/**
 * Tests for the description and topic sections' workspace scope: a
 * channel outside the shown accounts is never named or quoted (outcome
 * lists, current and proposed values, details, the missing-scope list),
 * only counted per workspace, with each list's title counting every
 * channel.
 */

import { describe, expect, it } from 'vitest';

import {
  channel,
  reportFacts as facts,
  reportInput as input,
} from './fakes.test-helper.js';
import { fieldSection } from './report-fields.js';
import type { ReportInput } from './report-input.js';

const globex = (id: string, over: Parameters<typeof facts>[1] = {}) =>
  facts(id, {
    channel: channel(id, {
      name: `globex-${id.toLowerCase()}`,
      account: 'globex',
    }),
    ...over,
  });

const section = (over: Partial<ReportInput>): string => {
  const i = input(over);
  return fieldSection(
    'description',
    i,
    new Map(i.facts.map((f) => [f.channel.id, f])),
  ).join('\n');
};

const NO_SCOPE = {
  description: { action: 'skip', reason: 'missing-scope' },
  topic: { action: 'skip', reason: 'fresh' },
} as const;

describe('fieldSection: workspace scope', () => {
  const scoped: Partial<ReportInput> = {
    facts: [
      facts('C1'),
      globex('C2'),
      globex('C3'),
      facts('C4', { plans: NO_SCOPE }),
      globex('C5', { plans: NO_SCOPE }),
    ],
    outcomes: [
      {
        id: 'C1',
        field: 'description',
        status: 'proposed',
        text: 'Mine',
        current: 'Was mine',
      },
      {
        id: 'C2',
        field: 'description',
        status: 'proposed',
        text: 'GLOBEX ',
        current: 'GLOBEX ',
      },
      {
        id: 'C3',
        field: 'description',
        status: 'failed',
        detail: 'GLOBEX ',
        text: 'GLOBEX ',
      },
    ],
  };

  it('names and quotes shown channels and counts the others per workspace', () => {
    const text = section(scoped);
    expect(text).toContain(
      '**Proposed (preview: not set)** (2):\n\n- #c1 (`C1`)\n  - current: \u201cWas mine\u201d\n  - proposed: \u201cMine\u201d\n- 1 channel(s) in `globex` (text not shown outside that workspace)',
    );
    expect(text).toContain(
      '**Failed** (1):\n\n- 1 channel(s) in `globex` (text not shown outside that workspace)',
    );
    expect(text).toContain(
      '**Left alone: the bot lacks the write scope** (2):\n\n- #c4 (`C4`)\n- 1 channel(s) in `globex` (text not shown outside that workspace)',
    );
    for (const s of ['GLOBEX ', 'GLOBEX ', 'GLOBEX ', 'GLOBEX '])
      expect(text).not.toContain(s);
    expect(text).not.toMatch(/globex-c\d|C2|C3|C5/);
  });

  it('names every channel of the shown accounts', () => {
    const text = section({
      ...scoped,
      textAccounts: new Set(['default', 'globex']),
    });
    expect(text).toContain('GLOBEX ');
    expect(text).toContain('#globex-c5 (`C5`)');
    expect(text).not.toContain('text not shown');
  });

  it('counts every channel when no account is shown', () => {
    const text = section({ ...scoped, textAccounts: new Set() });
    expect(text).toContain(
      '**Proposed (preview: not set)** (2):\n\n- 1 channel(s) in `default` (text not shown outside that workspace)\n- 1 channel(s) in `globex` (text not shown outside that workspace)',
    );
    expect(text).not.toContain('Mine');
  });
});
