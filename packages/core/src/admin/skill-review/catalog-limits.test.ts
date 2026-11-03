/**
 * Tests for the catalog limits and fitting: where the character budget
 * comes from (agent entry or list, shared limits, defaults; agent ids
 * normalized as OpenClaw does), and every branch of OpenClaw's fit, each
 * boundary computed with the formatter itself: full at the limit, the
 * compact description cap, descriptions omitted, the count cap, dropped
 * skills, the note-less fallbacks and nothing fitting.
 */

import { describe, expect, it } from 'vitest';

import {
  type CatalogSkill,
  formatCompactCatalog,
  formatFullCatalog,
} from './catalog-format.js';
import {
  DEFAULT_MAX_SKILLS_IN_PROMPT,
  DEFAULT_MAX_SKILLS_PROMPT_CHARS,
  normalizeAgentId,
  prepareCatalog,
  resolveCatalogLimits,
} from './catalog-limits.js';

describe('normalizeAgentId', () => {
  it.each([
    [' Main ', 'main'],
    ['ops_1-a', 'ops_1-a'],
    ['My Agent!', 'my-agent'],
    ['--x--', 'x'],
    ['_x', '_x'],
    ['!!!', 'main'],
    [undefined, 'main'],
    ['a'.repeat(70), 'a'.repeat(64)],
    [`-${'b'.repeat(70)}`, 'b'.repeat(64)],
  ])('%j -> %s', (id, expected) => {
    expect(normalizeAgentId(id)).toBe(expected);
  });
});

describe('resolveCatalogLimits', () => {
  it("uses OpenClaw's defaults without a config", () => {
    expect(resolveCatalogLimits(undefined, 'main')).toEqual({
      maxChars: DEFAULT_MAX_SKILLS_PROMPT_CHARS,
      maxCharsSource: 'default',
      maxSkills: DEFAULT_MAX_SKILLS_IN_PROMPT,
    });
    expect(DEFAULT_MAX_SKILLS_PROMPT_CHARS).toBe(18_000);
    expect(DEFAULT_MAX_SKILLS_IN_PROMPT).toBe(150);
  });

  const shared = {
    skills: { limits: { maxSkillsPromptChars: 36_000, maxSkillsInPrompt: 90 } },
  };

  it('uses skills.limits', () => {
    expect(resolveCatalogLimits(shared, 'main')).toEqual({
      maxChars: 36_000,
      maxCharsSource: 'skills.limits',
      maxSkills: 90,
    });
  });

  it.each([
    [
      'an agents.entries key',
      { entries: { ' MAIN ': { skillsLimits: { maxSkillsPromptChars: 5 } } } },
    ],
    [
      'an agents.list id',
      {
        list: [
          { id: 'other' },
          { id: 'Main', skillsLimits: { maxSkillsPromptChars: 5 } },
        ],
      },
    ],
    [
      'an agents.list entry without an id (main)',
      { list: [{ skillsLimits: { maxSkillsPromptChars: 5 } }] },
    ],
  ])("prefers the agent's own budget from %s", (_case, agents) => {
    expect(resolveCatalogLimits({ ...shared, agents }, 'main')).toEqual({
      maxChars: 5,
      maxCharsSource: 'agent',
      maxSkills: 90,
    });
  });

  it.each([
    [
      'another agent',
      { entries: { ops: { skillsLimits: { maxSkillsPromptChars: 5 } } } },
    ],
    ['no skillsLimits', { entries: { main: {} } }],
    ['null skillsLimits', { entries: { main: { skillsLimits: null } } }],
    ['no char budget', { list: [{ id: 'main', skillsLimits: {} }] }],
    [
      'a list entry when agents.entries is the roster',
      {
        entries: { ops: {} },
        list: [{ id: 'main', skillsLimits: { maxSkillsPromptChars: 5 } }],
      },
    ],
  ])('falls back to skills.limits for %s', (_case, agents) => {
    expect(
      resolveCatalogLimits({ ...shared, agents }, 'main').maxCharsSource,
    ).toBe('skills.limits');
  });

  it('accepts a zero budget', () => {
    expect(
      resolveCatalogLimits(
        { skills: { limits: { maxSkillsPromptChars: 0 } } },
        'main',
      ).maxChars,
    ).toBe(0);
  });

  it.each([
    ['a string budget', { skills: { limits: { maxSkillsPromptChars: '9' } } }],
    ['a negative count', { skills: { limits: { maxSkillsInPrompt: -1 } } }],
    [
      'a fractional agent budget',
      {
        agents: {
          entries: { main: { skillsLimits: { maxSkillsPromptChars: 1.5 } } },
        },
      },
    ],
  ])('throws on %s', (_case, config) => {
    expect(() => resolveCatalogLimits(config, 'main')).toThrow();
  });
});

const skill = (name: string, descriptionChars = 300): CatalogSkill => ({
  name,
  description: 'd'.repeat(descriptionChars),
  location: `/s/${name}`,
});

const COMPACT_SHORT =
  '\u26a0\ufe0f Skills catalog using compact format (descriptions shortened). Run `openclaw skills check` to audit.';
const COMPACT_OMITTED =
  '\u26a0\ufe0f Skills catalog using compact format (descriptions omitted). Run `openclaw skills check` to audit.';
const truncated = (included: number, total: number, details = '') =>
  `\u26a0\ufe0f Skills truncated: included ${String(included)} of ${String(total)}${details}. Run \`openclaw skills check\` to audit.`;

describe('prepareCatalog', () => {
  const four = ['d', 'b', 'a', 'c'].map((n) => skill(n));
  const sorted = [...four].sort((x, y) => x.name.localeCompare(y.name));
  const full = formatFullCatalog(sorted);

  it('keeps the full catalog, sorted by name, when it fits exactly', () => {
    expect(
      prepareCatalog(four, { maxChars: full.length, maxSkills: 150 }),
    ).toEqual({
      prompt: full,
      format: { kind: 'full' },
      included: 4,
      total: 4,
      fullChars: full.length,
    });
  });

  it('switches to compact one char over, with the longest cap (220) that fits', () => {
    const prepared = prepareCatalog(four, {
      maxChars: full.length - 1,
      maxSkills: 150,
    });
    expect(prepared).toEqual({
      prompt: `${COMPACT_SHORT}\n${formatCompactCatalog(sorted, 220)}`,
      format: { kind: 'compact', descriptionMaxChars: 220 },
      included: 4,
      total: 4,
      fullChars: full.length,
    });
  });

  it('finds the exact cap that fits', () => {
    const at50 = `${COMPACT_SHORT}\n${formatCompactCatalog(sorted, 50)}`;
    expect(
      prepareCatalog(four, { maxChars: at50.length, maxSkills: 150 }),
    ).toMatchObject({
      prompt: at50,
      format: { kind: 'compact', descriptionMaxChars: 50 },
    });
  });

  it('keeps the smallest cap, 4 chars, when it fits exactly', () => {
    const at4 = `${COMPACT_SHORT}\n${formatCompactCatalog(sorted, 4)}`;
    expect(
      prepareCatalog(four, { maxChars: at4.length, maxSkills: 150 }),
    ).toMatchObject({
      prompt: at4,
      format: { kind: 'compact', descriptionMaxChars: 4 },
    });
  });

  it('omits descriptions when not even 4 chars fit', () => {
    const at0 = `${COMPACT_OMITTED}\n${formatCompactCatalog(sorted, 0)}`;
    expect(
      prepareCatalog(four, { maxChars: at0.length, maxSkills: 150 }),
    ).toEqual({
      prompt: at0,
      format: { kind: 'compact', descriptionMaxChars: 0 },
      included: 4,
      total: 4,
      fullChars: full.length,
    });
  });

  it('lists only the first maxSkills by name, with the truncation note', () => {
    const two = sorted.slice(0, 2);
    expect(prepareCatalog(four, { maxChars: 1e6, maxSkills: 2 })).toEqual({
      prompt: `${truncated(2, 4)}\n${formatFullCatalog(two)}`,
      format: { kind: 'full' },
      included: 2,
      total: 4,
      fullChars: `${truncated(2, 4)}\n${formatFullCatalog(two)}`.length,
    });
  });

  it('treats a negative count cap as zero', () => {
    expect(
      prepareCatalog(four, { maxChars: 1e6, maxSkills: -1 }),
    ).toMatchObject({
      prompt: truncated(0, 4),
      included: 0,
    });
  });

  it('drops trailing skills when even names alone do not fit', () => {
    const at2 = `${truncated(2, 4, ' (compact format, descriptions omitted)')}\n${formatCompactCatalog(sorted.slice(0, 2), 0)}`;
    expect(
      prepareCatalog(four, { maxChars: at2.length, maxSkills: 150 }),
    ).toEqual({
      prompt: at2,
      format: { kind: 'compact', descriptionMaxChars: 0 },
      included: 2,
      total: 4,
      fullChars: full.length,
    });
  });

  it('falls back to the full catalog without its note when only that fits', () => {
    const first = skill('a', 1);
    const tiny = [first, skill('b', 1)];
    const bare = formatFullCatalog([first]);
    expect(
      prepareCatalog(tiny, { maxChars: bare.length, maxSkills: 1 }),
    ).toEqual({
      prompt: bare,
      format: { kind: 'full' },
      included: 1,
      total: 2,
      fullChars: `${truncated(1, 2)}\n${bare}`.length,
    });
  });

  it('falls back to a note-less compact catalog when no note fits', () => {
    const three = [skill('a', 30), skill('b', 30), skill('c', 30)];
    const bare = formatCompactCatalog(three.slice(0, 2), 0);
    expect(
      prepareCatalog(three, { maxChars: bare.length, maxSkills: 2 }),
    ).toEqual({
      prompt: bare,
      format: { kind: 'compact', descriptionMaxChars: 0 },
      included: 2,
      total: 3,
      fullChars: `${truncated(2, 3)}\n${formatFullCatalog(three.slice(0, 2))}`
        .length,
    });
  });

  it('lists nothing when nothing fits', () => {
    expect(prepareCatalog(four, { maxChars: 10, maxSkills: 150 })).toEqual({
      prompt: '',
      format: { kind: 'compact', descriptionMaxChars: 0 },
      included: 0,
      total: 4,
      fullChars: full.length,
    });
  });

  it('lists nothing under a negative budget', () => {
    expect(
      prepareCatalog(four, { maxChars: -1, maxSkills: 150 }),
    ).toMatchObject({
      prompt: '',
      included: 0,
    });
  });

  it('keeps an empty catalog full', () => {
    expect(prepareCatalog([], { maxChars: 0, maxSkills: 150 })).toEqual({
      prompt: '',
      format: { kind: 'full' },
      included: 0,
      total: 0,
      fullChars: 0,
    });
  });
});
