/**
 * @module admin/skill-review/catalog-limits
 *
 * How OpenClaw 2026.9.6 (`eb377ac`) fits the skills catalog into its character budget
 * (`prepareSkillsForPrompt` in `src/skills/loading/skill-prompt-limits.ts`,
 * without the remote-node note): the first `maxSkillsInPrompt` skills by
 * name; the full catalog when it fits `maxSkillsPromptChars`, else the
 * whole catalog switches to the compact format with the longest
 * description cap (4 to 220) that fits, dropping skills only when even
 * names alone don't fit. The limits come from `openclaw.json`: the agent's
 * `skillsLimits.maxSkillsPromptChars` (keyed `agents.entries`, else listed
 * in `agents.list`, ids matched as OpenClaw normalizes them;
 * `src/agents/agent-scope-config.ts`), else `skills.limits`, else
 * OpenClaw's defaults. A later OpenClaw that changes these needs a
 * re-port, not a guess. Pure.
 */

import { z } from 'zod';

import {
  type CatalogSkill,
  COMPACT_DESCRIPTION_MAX_CHARS,
  formatCompactCatalog,
  formatFullCatalog,
} from './catalog-format.js';

/** OpenClaw's default skill count cap. */
export const DEFAULT_MAX_SKILLS_IN_PROMPT = 150;

/** OpenClaw's default catalog character budget. */
export const DEFAULT_MAX_SKILLS_PROMPT_CHARS = 18_000;

const COMPACT_DESCRIPTION_MIN_CHARS = 4;

const limit = z.number().int().min(0).optional();
const agentSchema = z.looseObject({
  skillsLimits: z.looseObject({ maxSkillsPromptChars: limit }).nullish(),
});

/** The parts of `openclaw.json` the limits come from. */
const limitsConfigSchema = z.looseObject({
  skills: z
    .looseObject({
      limits: z
        .looseObject({ maxSkillsInPrompt: limit, maxSkillsPromptChars: limit })
        .optional(),
    })
    .optional(),
  agents: z
    .looseObject({
      entries: z.record(z.string(), agentSchema).optional(),
      list: z
        .array(agentSchema.extend({ id: z.string().optional() }))
        .optional(),
    })
    .optional(),
});

/** Where the character budget came from. */
export type CharLimitSource = 'agent' | 'skills.limits' | 'default';

/** The catalog limits in force for one agent. */
export interface CatalogLimits {
  /** Character budget. */
  maxChars: number;
  /** Its source. */
  maxCharsSource: CharLimitSource;
  /** Skill count cap. */
  maxSkills: number;
}

/**
 * An agent id as OpenClaw compares it (`normalizeAgentId`): trimmed and
 * lowercased, other characters than `a-z0-9_-` dashed, outer dashes cut,
 * at most 64 chars; nothing left (or no id) is `main`.
 *
 * @param id - An id, maybe missing.
 * @returns The canonical id.
 */
export function normalizeAgentId(id: string | undefined): string {
  const lower = (id ?? '').trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(lower)) return lower;
  const dashed = lower
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
  return dashed || 'main';
}

/**
 * The limits for an agent.
 *
 * @param openclawConfig - The parsed `openclaw.json` (`undefined`: none).
 * @param agentId - The agent.
 * @returns The limits.
 * @throws When the limit fields are malformed (OpenClaw would reject them).
 */
export function resolveCatalogLimits(
  openclawConfig: unknown,
  agentId: string,
): CatalogLimits {
  const config = limitsConfigSchema.parse(openclawConfig ?? {});
  const id = normalizeAgentId(agentId);
  // `agents.entries`, when present, is the only roster (no `list` fallback).
  const entries = config.agents?.entries;
  const entry = entries
    ? Object.entries(entries).find(([key]) => normalizeAgentId(key) === id)?.[1]
    : config.agents?.list?.find((a) => normalizeAgentId(a.id) === id);
  const agentChars = entry?.skillsLimits?.maxSkillsPromptChars;
  const sharedChars = config.skills?.limits?.maxSkillsPromptChars;
  const [maxChars, maxCharsSource]: [number, CharLimitSource] =
    agentChars !== undefined
      ? [agentChars, 'agent']
      : sharedChars !== undefined
        ? [sharedChars, 'skills.limits']
        : [DEFAULT_MAX_SKILLS_PROMPT_CHARS, 'default'];
  return {
    maxChars,
    maxCharsSource,
    maxSkills:
      config.skills?.limits?.maxSkillsInPrompt ?? DEFAULT_MAX_SKILLS_IN_PROMPT,
  };
}

/** The format OpenClaw picks. */
export type CatalogFormat =
  { kind: 'full' } | { kind: 'compact'; descriptionMaxChars: number };

/** The catalog OpenClaw would put in the prompt. */
export interface PreparedCatalog {
  /** Prompt text (limit note and catalog). */
  prompt: string;
  /** The format. */
  format: CatalogFormat;
  /** Skills listed. */
  included: number;
  /** Skills visible. */
  total: number;
  /**
   * The length of the full-format prompt OpenClaw tests against the
   * budget (the first `maxSkills` skills and, when that cuts any, the
   * truncation note), whether or not it fits.
   */
  fullChars: number;
}

const limitNote = (
  included: number,
  total: number,
  format: CatalogFormat,
): string => {
  const details =
    format.kind === 'compact'
      ? format.descriptionMaxChars > 0
        ? 'descriptions shortened'
        : 'descriptions omitted'
      : '';
  if (included < total)
    return `\u26a0\ufe0f Skills truncated: included ${String(included)} of ${String(total)}${details ? ` (compact format, ${details})` : ''}. Run \`openclaw skills check\` to audit.`;
  return details
    ? `\u26a0\ufe0f Skills catalog using compact format (${details}). Run \`openclaw skills check\` to audit.`
    : '';
};

/**
 * Fit the catalog to the limits as OpenClaw does.
 *
 * @param visible - The model-visible skills, any order.
 * @param limits - The limits.
 * @returns The prepared catalog.
 */
export function prepareCatalog(
  visible: readonly CatalogSkill[],
  limits: Pick<CatalogLimits, 'maxChars' | 'maxSkills'>,
): PreparedCatalog {
  const ordered = [...visible].sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  );
  const total = ordered.length;
  const byCount = ordered.slice(0, Math.max(0, limits.maxSkills));
  const build = (
    skills: readonly CatalogSkill[],
    format: CatalogFormat,
    withNote: boolean,
  ): string => {
    const catalog =
      format.kind === 'compact'
        ? formatCompactCatalog(skills, format.descriptionMaxChars)
        : formatFullCatalog(skills);
    const note = withNote ? limitNote(skills.length, total, format) : '';
    return [note, catalog].filter(Boolean).join('\n');
  };
  const render = (
    skills: readonly CatalogSkill[],
    format: CatalogFormat,
    withNote = true,
  ): string | undefined => {
    const prompt = build(skills, format, withNote);
    return prompt.length <= limits.maxChars ? prompt : undefined;
  };
  const compact = (cap: number): CatalogFormat => ({
    kind: 'compact',
    descriptionMaxChars: cap,
  });
  const fits = (
    skills: readonly CatalogSkill[],
    cap: number,
    withNote = true,
  ) => render(skills, compact(cap), withNote) !== undefined;
  /** The most leading skills that fit with no descriptions. */
  const mostThatFit = (pool: readonly CatalogSkill[], withNote: boolean) => {
    let lo = 0;
    let hi = pool.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(pool.slice(0, mid), 0, withNote)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const fullPrompt = build(byCount, { kind: 'full' }, true);
  const done = (prompt: string, format: CatalogFormat, included: number) => ({
    prompt,
    format,
    included,
    total,
    fullChars: fullPrompt.length,
  });

  if (fullPrompt.length <= limits.maxChars)
    return done(fullPrompt, { kind: 'full' }, byCount.length);

  let listed = fits(byCount, 0)
    ? byCount
    : byCount.slice(0, mostThatFit(byCount, true));
  if (listed.length === 0 && byCount.length > 0) {
    const bare = render(byCount, { kind: 'full' }, false);
    if (bare !== undefined) return done(bare, { kind: 'full' }, byCount.length);
    listed = byCount.slice(0, mostThatFit(byCount, false));
  }
  const withNote = fits(listed, 0);
  let cap = 0;
  if (
    listed.length > 0 &&
    fits(listed, COMPACT_DESCRIPTION_MIN_CHARS, withNote)
  ) {
    let lo = COMPACT_DESCRIPTION_MIN_CHARS;
    let hi = COMPACT_DESCRIPTION_MAX_CHARS;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(listed, mid, withNote)) lo = mid;
      else hi = mid - 1;
    }
    cap = lo;
  }
  // `listed` and `cap` were chosen to fit, so this renders; OpenClaw's
  // "no prompt, no skills" case is only reachable with nothing listed.
  const prompt = render(listed, compact(cap), withNote) ?? '';
  return done(prompt, compact(cap), listed.length);
}
