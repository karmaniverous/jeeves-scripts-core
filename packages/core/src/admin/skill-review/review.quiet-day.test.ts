/**
 * Tests for the review flow on a quiet day (nothing pending): no snapshot
 * or worker; the skills catalog budget is still measured and an alert
 * posted to the review channel only when one is due (threshold from the
 * settings); under the threshold nothing is posted; a measuring or
 * inventory failure only warns; previews log the alert instead.
 */

import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { CatalogBudget } from './catalog-budget.js';
import { catalogBudgetFixture } from './catalog-budget.test-helper.js';
import { budgetAlertPost } from './catalog-budget-render.js';
import type { InventorySkill } from './inventory.js';
import { type ReviewDeps, reviewWorkshop } from './review.js';
import {
  DRY_RUN,
  LIVE,
  PRINT_TASK,
  useReviewFlow,
} from './review-flow.test-helper.js';

const { deps } = useReviewFlow();

const SKIP =
  '[skip] admin/review-skill-proposals: no pending Workshop proposals';

/** A full-format budget using `chars` of 18,000. */
const using = (chars: number, over: Partial<CatalogBudget> = {}) =>
  catalogBudgetFixture({
    chars,
    headroom: 18_000 - chars,
    usedPct: (chars / 18_000) * 100,
    ...over,
  });

const quietDeps = (budget: CatalogBudget, over: Partial<ReviewDeps> = {}) =>
  deps([], undefined, {
    catalogBudget: vi.fn<ReviewDeps['catalogBudget']>(() =>
      Promise.resolve(budget),
    ),
    ...over,
  });

describe('reviewWorkshop on a quiet day', () => {
  it('posts nothing under the threshold: no snapshot, no worker', async () => {
    const inventory: InventorySkill[] = [
      {
        name: 'x',
        description: '',
        origin: 'local',
        file: '/x/SKILL.md',
        bytes: 1,
        text: '',
      },
    ];
    // 16,199 / 18,000 is 89.99%: shown as 89.9%, under 90.
    const { d, lines, posts } = quietDeps(using(16_199), {
      readInventory: () => inventory,
    });
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('skipped');
    expect(d.catalogBudget).toHaveBeenCalledWith(inventory);
    expect(lines).toEqual([
      SKIP,
      'admin/review-skill-proposals: skills catalog under 90% of its budget; no alert',
    ]);
    expect(posts).toEqual([]);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(fs.existsSync(d.runsRoot)).toBe(false);
  });

  it('posts the alert to the review channel at the threshold', async () => {
    const budget = using(16_200);
    const { d, lines, posts } = quietDeps(budget);
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('alerted');
    expect(posts).toEqual([
      {
        channel: 'C123',
        text: budgetAlertPost(budget, 90),
        account: 'default',
      },
    ]);
    expect(posts[0]?.text).toContain('uses 90.0% of its character budget');
    expect(lines).toEqual([
      SKIP,
      'admin/review-skill-proposals: skills catalog alert sent',
    ]);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(fs.existsSync(d.runsRoot)).toBe(false);
  });

  it('takes the threshold and the channel from the settings', async () => {
    const settings = deps([]).d.settings();
    const at = (budgetAlertPercent: number) =>
      quietDeps(using(14_400), {
        settings: () => ({
          ...settings,
          reportChannel: 'C777',
          budgetAlertPercent,
        }),
      });
    // 14,400 / 18,000 is 80%.
    const low = at(80);
    await expect(reviewWorkshop(LIVE, low.d)).resolves.toBe('alerted');
    expect(low.posts[0]?.channel).toBe('C777');
    expect(low.posts[0]?.text).toContain('(alert at 80%)');
    const high = at(81);
    await expect(reviewWorkshop(LIVE, high.d)).resolves.toBe('skipped');
    expect(high.posts).toEqual([]);
    expect(high.lines.at(-1)).toContain('under 81% of its budget');
  });

  it('alerts under the threshold when the catalog is already compact', async () => {
    const { d, posts } = quietDeps(
      using(10_000, { format: { kind: 'compact', descriptionMaxChars: 220 } }),
    );
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('alerted');
    expect(posts[0]?.text).toContain('already in the COMPACT format');
  });

  it.each([
    [
      'the budget',
      {
        catalogBudget: vi.fn<ReviewDeps['catalogBudget']>(() =>
          Promise.reject(new Error('gateway call failed')),
        ),
      },
      'gateway call failed',
    ],
    [
      'the inventory',
      {
        readInventory: () => {
          throw new Error('unreadable skills dir');
        },
      },
      'unreadable skills dir',
    ],
  ])(
    'warns and posts nothing when %s fails',
    async (_label, over: Partial<ReviewDeps>, problem) => {
      const { d, lines, posts } = quietDeps(using(17_900), over);
      await expect(reviewWorkshop(LIVE, d)).resolves.toBe('skipped');
      expect(lines).toEqual([
        SKIP,
        `[warn] admin/review-skill-proposals: skills catalog budget unavailable: ${problem}`,
      ]);
      expect(posts).toEqual([]);
    },
  );

  it.each([
    ['dry run', DRY_RUN],
    ['print task', PRINT_TASK],
  ])('logs the alert on a %s instead of posting', async (_label, flags) => {
    const budget = using(17_100);
    const { d, lines, posts } = quietDeps(budget);
    await expect(reviewWorkshop(flags, d)).resolves.toBe('previewed');
    expect(posts).toEqual([]);
    expect(lines).toEqual([
      SKIP,
      ...(budgetAlertPost(budget, 90) ?? '')
        .split('\n')
        .map((line) => `admin/review-skill-proposals: ${line}`),
      'admin/review-skill-proposals: preview only; the alert above would go to C123',
    ]);
    expect(d.dispatch).not.toHaveBeenCalled();
  });
});
