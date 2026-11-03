/**
 * @module admin/skill-review/catalog-budget.test-helper
 *
 * A measured skills catalog budget for the skill-review tests (render,
 * review flow): a full-format catalog at 95% of an 18,000-char budget,
 * with two long descriptions. Override any field.
 */

import type { CatalogBudget } from './catalog-budget.js';

/**
 * A budget fixture.
 *
 * @param over - Fields to replace.
 * @returns The budget.
 */
export const catalogBudgetFixture = (
  over: Partial<CatalogBudget> = {},
): CatalogBudget => ({
  maxChars: 18_000,
  maxCharsSource: 'skills.limits',
  maxSkills: 150,
  agentId: 'main',
  skills: 97,
  included: 97,
  chars: 17_100,
  headroom: 900,
  usedPct: 95,
  format: { kind: 'full' },
  longCount: 2,
  longExcess: 250,
  longest: [
    { name: 'jeeves-design', bytes: 381, owner: 'jeeves' },
    { name: 'jeeves-email', bytes: 189, owner: 'jeeves-scripts-core' },
  ],
  minContextTokens: 85_500,
  ...over,
});
