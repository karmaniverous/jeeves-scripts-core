/**
 * Tests for the budget in words: the two Slack lines (format, headroom or
 * overrun, a short list, the longest three Slack-escaped, no long
 * descriptions) and the report section (limit source, table, longest
 * descriptions, the margin note), plus "unavailable" in both; the
 * quiet-day alert (at the threshold as shown, compact, count-capped).
 */

import { describe, expect, it } from 'vitest';

import type { CatalogBudget } from './catalog-budget.js';
import { catalogBudgetFixture } from './catalog-budget.test-helper.js';
import {
  BUDGET_MARGIN_NOTE,
  budgetAlertPost,
  budgetReportSection,
  budgetSlackLines,
  LONGEST_IN_SLACK,
} from './catalog-budget-render.js';

describe('budgetSlackLines', () => {
  it('reads unavailable without a budget', () => {
    expect(budgetSlackLines({ problem: 'x' })).toEqual([
      '*Skills catalog budget:* unavailable (see the job log).',
    ]);
  });

  it('gives usage, format, headroom and the longest descriptions', () => {
    expect(budgetSlackLines(catalogBudgetFixture())).toEqual([
      '*Skills catalog budget:* 17,100 / 18,000 chars (95.0%), full format; 900 chars (5.0%) to spare.',
      '2 description(s) over 160 bytes, 250 bytes over in all; longest: `jeeves-design` 381 bytes (jeeves), `jeeves-email` 189 bytes (jeeves-scripts-core).',
    ]);
  });

  it('flags compact mode, an overrun and a short list; names at most three, escaped', () => {
    const longest = ['a<b>', 'c&d', 'e', 'f'].map((name) => ({
      name,
      bytes: 200,
      owner: '<!here>',
    }));
    const [first, second] = budgetSlackLines(
      catalogBudgetFixture({
        chars: 19_000,
        headroom: -1_000,
        usedPct: 105.5,
        included: 90,
        format: { kind: 'compact', descriptionMaxChars: 120 },
        longCount: 4,
        longest,
      }),
    );
    expect(first).toBe(
      '*Skills catalog budget:* 19,000 / 18,000 chars (105.5%), COMPACT format (descriptions cut to 120 chars); 1,000 chars over. Only 90 of 97 skills are listed.',
    );
    expect(second).toContain(
      'longest: `a&lt;b&gt;` 200 bytes (&lt;!here&gt;), `c&amp;d` 200 bytes (&lt;!here&gt;), `e` 200 bytes (&lt;!here&gt;).',
    );
    expect(LONGEST_IN_SLACK).toBe(3);
  });

  it('says when descriptions are omitted and none are long', () => {
    expect(
      budgetSlackLines(
        catalogBudgetFixture({
          format: { kind: 'compact', descriptionMaxChars: 0 },
          longCount: 0,
          longExcess: 0,
          longest: [],
        }),
      ),
    ).toEqual([
      '*Skills catalog budget:* 17,100 / 18,000 chars (95.0%), COMPACT format (descriptions omitted); 900 chars (5.0%) to spare.',
      'No description over 160 bytes.',
    ]);
  });

  it.each([
    [17_950, '99.7%'],
    [17_995, '99.9%'],
    // (198 / 18,000) * 100 is 1.0999999999999999 in floating point.
    [198, '1.1%'],
  ])('never rounds %i chars with some to spare up to 100%%', (chars, used) => {
    const spare = `${(100 - Number.parseFloat(used)).toFixed(1)}%`;
    const budget = catalogBudgetFixture({
      chars,
      headroom: 18_000 - chars,
      usedPct: (chars / 18_000) * 100,
    });
    expect(budgetSlackLines(budget)[0]).toContain(
      `chars (${used}), full format; ${(18_000 - chars).toLocaleString('en-US')} chars (${spare}) to spare.`,
    );
    expect(budgetReportSection(budget)).toContain(`| Used | ${used}; `);
  });

  it.each([
    [18_007, '100.1%'],
    [18_019, '100.2%'],
    // (19,800 / 18,000) * 100 is 110.00000000000001 in floating point.
    [19_800, '110.0%'],
  ])('never rounds %i chars (over) down to the budget', (chars, used) => {
    const budget = catalogBudgetFixture({
      chars,
      headroom: 18_000 - chars,
      usedPct: (chars / 18_000) * 100,
    });
    expect(budgetSlackLines(budget)[0]).toContain(`chars (${used}),`);
    expect(budgetReportSection(budget)).toContain(`| Used | ${used}; `);
  });

  it('counts a catalog exactly at the budget as nothing to spare, not over', () => {
    expect(
      budgetSlackLines(
        catalogBudgetFixture({ chars: 18_000, headroom: 0, usedPct: 100 }),
      )[0],
    ).toBe(
      '*Skills catalog budget:* 18,000 / 18,000 chars (100.0%), full format; 0 chars (0.0%) to spare.',
    );
  });
});

describe('budgetAlertPost', () => {
  const using = (chars: number) =>
    catalogBudgetFixture({
      chars,
      headroom: 18_000 - chars,
      usedPct: (chars / 18_000) * 100,
    });

  it('alerts at the threshold with the budget lines and advice', () => {
    expect(budgetAlertPost(using(16_200), 90)).toBe(
      [
        '*Skills catalog alert:* no Workshop proposals are pending today, but the skills catalog uses 90.0% of its character budget (alert at 90%).',
        '*Skills catalog budget:* 16,200 / 18,000 chars (90.0%), full format; 1,800 chars (10.0%) to spare.',
        '2 description(s) over 160 bytes, 250 bytes over in all; longest: `jeeves-design` 381 bytes (jeeves), `jeeves-email` 189 bytes (jeeves-scripts-core).',
        'Shorten the longest descriptions or raise the character budget before OpenClaw switches the catalog to the compact format.',
      ].join('\n'),
    );
  });

  it.each([
    // 16,199 / 18,000 is 89.994%: shown as 89.9%.
    [16_199, 90],
    [17_999, 100],
  ])(
    'stays quiet under the threshold as shown (%i chars, %i%%)',
    (chars, percent) => {
      expect(budgetAlertPost(using(chars), percent)).toBeUndefined();
    },
  );

  it('compares the share as shown, absorbing float error', () => {
    // (10,260 / 18,000) * 100 is 56.99999999999999 in floating point.
    expect(budgetAlertPost(using(10_260), 57)).toContain(
      'uses 57.0% of its character budget (alert at 57%)',
    );
  });

  it('alerts at 100% only when the catalog fills the budget', () => {
    expect(budgetAlertPost(using(18_000), 100)).toContain(
      'uses 100.0% of its character budget (alert at 100%)',
    );
  });

  it('alerts under the threshold when the catalog is already compact', () => {
    const post = budgetAlertPost(
      catalogBudgetFixture({
        format: { kind: 'compact', descriptionMaxChars: 220 },
      }),
      99,
    );
    expect(post?.split('\n')[0]).toBe(
      '*Skills catalog alert:* no Workshop proposals are pending today, but the skills catalog is already in the COMPACT format.',
    );
    expect(post?.split('\n').at(-1)).toBe(
      'Shorten the longest descriptions or raise the character budget to restore the full format.',
    );
  });

  it('adds the count-cap advice to a compact alert only when the cap cuts skills', () => {
    const advice = (over: Partial<CatalogBudget>) =>
      budgetAlertPost(
        catalogBudgetFixture({
          format: { kind: 'compact', descriptionMaxChars: 0 },
          ...over,
        }),
        99,
      )
        ?.split('\n')
        .at(-1);
    expect(advice({ maxSkills: 90, included: 90 })).toBe(
      'Shorten the longest descriptions or raise the character budget to restore the full format. Raise `skills.limits.maxSkillsInPrompt` or retire skills so every skill is listed.',
    );
    // Skills dropped by the character budget alone: no count-cap advice.
    expect(advice({ included: 90 })).toBe(
      'Shorten the longest descriptions or raise the character budget to restore the full format.',
    );
  });

  it('alerts under the threshold when the count cap leaves skills out', () => {
    const post = budgetAlertPost(
      catalogBudgetFixture({ maxSkills: 90, included: 90 }),
      99,
    );
    expect(post?.split('\n')[0]).toBe(
      '*Skills catalog alert:* no Workshop proposals are pending today, but the skill count cap already leaves skills out of the catalog.',
    );
    expect(post).toContain('Only 90 of 97 skills are listed.');
    expect(post?.split('\n').at(-1)).toBe(
      'Raise `skills.limits.maxSkillsInPrompt` or retire skills so every skill is listed.',
    );
  });
});

describe('budgetReportSection', () => {
  it('reads unavailable with the reason', () => {
    expect(budgetReportSection({ problem: 'gateway down' })).toBe(
      '## Skills catalog budget\n\nUnavailable: gateway down\n',
    );
  });

  it('tabulates the budget, the longest descriptions and the margin', () => {
    expect(budgetReportSection(catalogBudgetFixture())).toBe(
      [
        '## Skills catalog budget',
        '',
        'Agent `main`. When the full catalog exceeds the character budget, OpenClaw switches the whole catalog to the compact format (descriptions cut to at most 220 chars).',
        '',
        '| Measure | Value |',
        '| --- | --- |',
        '| Full catalog | 17,100 chars, 97 model-visible skills |',
        '| Character budget | 18,000 (`skills.limits.maxSkillsPromptChars`) |',
        '| Used | 95.0%; 900 chars (5.0%) to spare |',
        '| Format in force | full format |',
        '| Skills listed | 97 of 97 (cap 150) |',
        '| Long descriptions | 2 description(s) over 160 bytes, 250 bytes over in all |',
        '| Token share | descriptions are also cut when the catalog exceeds a fifth of the model context in tokens: the full catalog fits models with 85,500+ tokens |',
        '',
        '**Longest descriptions**',
        '',
        '| Skill | Bytes | Owner |',
        '| --- | --- | --- |',
        '| `jeeves-design` | 381 | jeeves |',
        '| `jeeves-email` | 189 | jeeves-scripts-core |',
        '',
        BUDGET_MARGIN_NOTE,
        '',
      ].join('\n'),
    );
  });

  it('says the count cap limits what is measured when it cuts skills', () => {
    expect(
      budgetReportSection(
        catalogBudgetFixture({ maxSkills: 90, included: 90 }),
      ),
    ).toContain(
      '| Full catalog | 17,100 chars: the first 90 of 97 model-visible skills (the count cap) and the truncation note |',
    );
    expect(
      budgetReportSection(
        catalogBudgetFixture({ maxSkills: 97, included: 90 }),
      ),
    ).toContain('| Full catalog | 17,100 chars, 97 model-visible skills |');
  });

  it.each([
    ['agent', 'agent `ops` `skillsLimits.maxSkillsPromptChars`'],
    ['default', "OpenClaw's default"],
  ] as const)(
    'names the %s limit source; no longest table without long descriptions',
    (source, text) => {
      const section = budgetReportSection(
        catalogBudgetFixture({
          maxCharsSource: source,
          agentId: 'ops',
          longest: [],
        }),
      );
      expect(section).toContain(`| Character budget | 18,000 (${text}) |`);
      expect(section).not.toContain('**Longest descriptions**');
    },
  );
});
