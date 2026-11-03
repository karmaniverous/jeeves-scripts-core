/**
 * Tests for the catalog budget: only model-visible skills count, the
 * catalog is measured with home paths shown as `~/`, headroom and usage
 * against the resolved budget, the format OpenClaw would pick, long
 * descriptions (count, excess, order, owners; in UTF-8 bytes, as OpenClaw
 * limits a description) and the token share.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyzeCatalogBudget,
  CONTEXT_TOKENS_PER_CHAR,
  LONGEST_SHOWN,
  type SkillsStatus,
  skillsStatusSchema,
} from './catalog-budget.js';
import { formatFullCatalog } from './catalog-format.js';
import { DESCRIPTION_MAX_BYTES } from './checks.js';

const HOME = path.resolve('/home/me');

const entry = (name: string, chars: number, visible = true, char = 'x') => ({
  name,
  description: char.repeat(chars),
  source: 'openclaw-extra',
  filePath: path.join(HOME, 'skills', name, 'SKILL.md'),
  modelVisible: visible,
});

const status = (skills: ReturnType<typeof entry>[]): SkillsStatus =>
  skillsStatusSchema.parse({ agentId: 'main', skills, workspaceDir: '/w' });

const analyze = (s: SkillsStatus, openclawConfig?: unknown) =>
  analyzeCatalogBudget({
    status: s,
    openclawConfig,
    homeDirs: [HOME],
    originOf: (file) =>
      file === path.join(HOME, 'skills', 'b', 'SKILL.md')
        ? 'jeeves'
        : undefined,
  });

describe('skillsStatusSchema', () => {
  it('rejects a report without skill paths', () => {
    expect(() =>
      skillsStatusSchema.parse({ agentId: 'main', skills: [{ name: 'a' }] }),
    ).toThrow();
  });
});

describe('analyzeCatalogBudget', () => {
  it('measures the visible skills with ~/ locations against the budget', () => {
    const budget = analyze(
      status([entry('a', 10), entry('hidden', 999, false)]),
    );
    const chars = formatFullCatalog([
      {
        name: 'a',
        description: 'x'.repeat(10),
        location: '~/skills/a/SKILL.md',
      },
    ]).length;
    expect(budget).toEqual({
      maxChars: 18_000,
      maxCharsSource: 'default',
      maxSkills: 150,
      agentId: 'main',
      skills: 1,
      included: 1,
      chars,
      headroom: 18_000 - chars,
      usedPct: (chars / 18_000) * 100,
      format: { kind: 'full' },
      longCount: 0,
      longExcess: 0,
      longest: [],
      minContextTokens: chars * CONTEXT_TOKENS_PER_CHAR,
    });
    expect(CONTEXT_TOKENS_PER_CHAR).toBe(5);
  });

  it('reports compact mode and negative headroom over the budget', () => {
    const config = { skills: { limits: { maxSkillsPromptChars: 500 } } };
    const budget = analyze(status([entry('a', 400), entry('b', 400)]), config);
    expect(budget.format.kind).toBe('compact');
    expect(budget.maxCharsSource).toBe('skills.limits');
    expect(budget.headroom).toBe(500 - budget.chars);
    expect(budget.headroom).toBeLessThan(0);
    expect(budget.usedPct).toBeCloseTo((budget.chars / 500) * 100);
  });

  it('counts a zero budget as one char for the percentage', () => {
    const config = { skills: { limits: { maxSkillsPromptChars: 0 } } };
    const budget = analyze(status([entry('a', 1)]), config);
    expect(budget.usedPct).toBe(budget.chars * 100);
    expect(budget.included).toBe(0);
  });

  it('measures what OpenClaw tests when the count cap cuts skills: the first ones and the note', () => {
    const listed = ['a', 'b'].map((name) => ({
      name,
      description: 'x'.repeat(50),
      location: `~/skills/${name}/SKILL.md`,
    }));
    const tested = `\u26a0\ufe0f Skills truncated: included 2 of 3. Run \`openclaw skills check\` to audit.\n${formatFullCatalog(listed)}`;
    const config = {
      skills: {
        limits: { maxSkillsInPrompt: 2, maxSkillsPromptChars: tested.length },
      },
    };
    const budget = analyze(
      status([entry('c', 900), entry('b', 50), entry('a', 50)]),
      config,
    );
    expect(budget).toMatchObject({
      format: { kind: 'full' },
      included: 2,
      skills: 3,
      chars: tested.length,
      headroom: 0,
      minContextTokens: tested.length * CONTEXT_TOKENS_PER_CHAR,
    });
  });

  it('counts descriptions over the target, longest first, ties by name, with owners', () => {
    const over = DESCRIPTION_MAX_BYTES;
    const budget = analyze(
      status([
        entry('a', over),
        entry('c', over + 5),
        entry('b', over + 5),
        entry('d', over + 40),
        entry('e', over + 1),
        entry('f', over + 2),
        entry('g', over + 3),
        entry('h', over + 90, false),
      ]),
    );
    expect(DESCRIPTION_MAX_BYTES).toBe(160);
    expect(budget.longCount).toBe(6);
    expect(budget.longExcess).toBe(40 + 5 + 5 + 3 + 2 + 1);
    expect(budget.longest).toEqual([
      { name: 'd', bytes: over + 40, owner: 'openclaw-extra' },
      { name: 'b', bytes: over + 5, owner: 'jeeves' },
      { name: 'c', bytes: over + 5, owner: 'openclaw-extra' },
      { name: 'g', bytes: over + 3, owner: 'openclaw-extra' },
      { name: 'f', bytes: over + 2, owner: 'openclaw-extra' },
    ]);
    expect(budget.longest).toHaveLength(LONGEST_SHOWN);
  });

  it('measures a description in UTF-8 bytes, not chars, as OpenClaw limits it', () => {
    // 81 two-byte chars: 81 chars, 162 bytes; 160 three-byte chars: 480 bytes.
    const budget = analyze(
      status([entry('a', 81, true, '\u00e9'), entry('b', 160, true, '\u20ac')]),
    );
    expect(budget.longest).toEqual([
      { name: 'b', bytes: 480, owner: 'jeeves' },
      { name: 'a', bytes: 162, owner: 'openclaw-extra' },
    ]);
    expect(budget.longExcess).toBe(2 + 320);
  });
});
