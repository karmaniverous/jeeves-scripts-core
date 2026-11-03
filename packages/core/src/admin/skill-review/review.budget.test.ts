/**
 * Tests for the skills catalog budget in the review flow: measured against
 * the inventory, a measuring failure warns and reads "unavailable" in the
 * post and the report without blocking the post, and previews log the
 * budget lines.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { type ReviewDeps, reviewWorkshop } from './review.js';
import {
  DRY_RUN,
  LIVE,
  proposal,
  useReviewFlow,
  validReport,
} from './review-flow.test-helper.js';

const { root, deps } = useReviewFlow();

describe('reviewWorkshop', () => {
  it('measures the budget against the inventory; a failure warns and reads "unavailable" without blocking the post', async () => {
    const inventory = [
      {
        name: 'x',
        description: '',
        origin: 'local' as const,
        file: '/x/SKILL.md',
        bytes: 1,
        text: '',
      },
    ];
    const { d, lines, posts } = deps([proposal('a')], validReport, {
      readInventory: () => inventory,
      catalogBudget: vi.fn<ReviewDeps['catalogBudget']>(() =>
        Promise.reject(new Error('gateway call failed')),
      ),
    });
    await expect(reviewWorkshop(LIVE, d)).resolves.toBe('delivered');
    expect(d.catalogBudget).toHaveBeenCalledWith(inventory);
    expect(lines).toContain(
      '[warn] admin/review-skill-proposals: skills catalog budget unavailable: gateway call failed',
    );
    expect(posts[0]?.text).toContain(
      '*Skills catalog budget:* unavailable (see the job log).',
    );
    expect(
      fs.readFileSync(path.join(root(), 'out', '2026-10-21.md'), 'utf8'),
    ).toMatch(
      /\n\n## Skills catalog budget\n\nUnavailable: gateway call failed\n$/,
    );
  });

  it('logs the budget lines on a preview', async () => {
    const { d, lines } = deps([proposal('a')], validReport);
    await reviewWorkshop(DRY_RUN, d);
    expect(lines).toContain(
      'admin/review-skill-proposals: *Skills catalog budget:* 17,100 / 18,000 chars (95.0%), full format; 900 chars (5.0%) to spare.',
    );
    expect(lines.at(-1)).toContain('preview only');
  });
});
