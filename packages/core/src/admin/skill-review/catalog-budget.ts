/**
 * @module admin/skill-review/catalog-budget
 *
 * How close the skills catalog is to OpenClaw's compact-format threshold.
 * Input: the gateway's `skills.status` report for its default agent
 * (model-visible skills with their SKILL.md paths and descriptions, as the
 * gateway loaded them), `openclaw.json` and the home directories. The
 * full catalog is rebuilt with OpenClaw's formatter (`skill-review/catalog-format`)
 * and fitted to the limits (`skill-review/catalog-limits`); the result is the full
 * catalog's length as OpenClaw tests it (count cap and truncation note
 * included) against the character budget, whether compact mode is
 * on, descriptions over 160 UTF-8 bytes (OpenClaw's description limit,
 * as `src/skills/workshop/proposal-draft.ts` enforces it) and the
 * longest ones, and the
 * smallest model context (in tokens) whose one-fifth share still holds the
 * full catalog. Pure.
 */

import { z } from 'zod';

import { type CatalogSkill, promptLocation } from './catalog-format.js';
import {
  type CatalogFormat,
  type CatalogLimits,
  prepareCatalog,
  resolveCatalogLimits,
} from './catalog-limits.js';
import { DESCRIPTION_MAX_BYTES } from './checks.js';

/** OpenClaw keeps the catalog within one fifth of the context, in tokens. */
export const CONTEXT_TOKENS_PER_CHAR = 5;

/** The longest descriptions listed. */
export const LONGEST_SHOWN = 5;

/** The gateway's `skills.status` report (the fields read). */
export const skillsStatusSchema = z.looseObject({
  agentId: z.string(),
  skills: z.array(
    z.looseObject({
      name: z.string(),
      description: z.string(),
      source: z.string(),
      filePath: z.string(),
      modelVisible: z.boolean(),
    }),
  ),
});

/** A validated `skills.status` report. */
export type SkillsStatus = z.infer<typeof skillsStatusSchema>;

/** A long description. */
export interface LongDescription {
  /** Skill name. */
  name: string;
  /** Description size (UTF-8 bytes). */
  bytes: number;
  /** Who owns it: the inventory origin, else OpenClaw's source. */
  owner: string;
}

/** The catalog's budget. */
export interface CatalogBudget extends CatalogLimits {
  /** The agent whose catalog this is. */
  agentId: string;
  /** Model-visible skills. */
  skills: number;
  /** Skills OpenClaw would list. */
  included: number;
  /**
   * The full catalog's length (characters), as OpenClaw tests it against
   * the budget: the first `maxSkills` skills, plus the truncation note
   * when that cap cuts any.
   */
  chars: number;
  /** `maxChars - chars` (negative when over). */
  headroom: number;
  /** `chars / maxChars` as a percentage (a zero budget counts as 1). */
  usedPct: number;
  /** The format OpenClaw picks. */
  format: CatalogFormat;
  /** Descriptions over `DESCRIPTION_MAX_BYTES` (UTF-8 bytes). */
  longCount: number;
  /** Their bytes over it, summed. */
  longExcess: number;
  /** The longest descriptions, longest first. */
  longest: LongDescription[];
  /** The smallest context window (tokens) whose share holds the full catalog. */
  minContextTokens: number;
}

/** What the analysis needs. */
export interface CatalogBudgetInput {
  /** The gateway's `skills.status` report. */
  status: SkillsStatus;
  /** The parsed `openclaw.json`. */
  openclawConfig: unknown;
  /** Home directories as OpenClaw resolves them. */
  homeDirs: readonly string[];
  /** A SKILL.md's inventory origin, when known. */
  originOf: (file: string) => string | undefined;
}

/**
 * Measure the catalog.
 *
 * @param input - Status, config, homes and origins.
 * @returns The budget.
 * @throws When the limit fields in `openclaw.json` are malformed.
 */
export function analyzeCatalogBudget(input: CatalogBudgetInput): CatalogBudget {
  const { status } = input;
  const visible = status.skills.filter((s) => s.modelVisible);
  const limits = resolveCatalogLimits(input.openclawConfig, status.agentId);
  const catalog: CatalogSkill[] = visible.map((s) => ({
    name: s.name,
    description: s.description,
    location: promptLocation(s.filePath, input.homeDirs),
  }));
  const fitted = prepareCatalog(catalog, limits);
  const chars = fitted.fullChars;
  const long = visible
    .map((s) => ({
      name: s.name,
      bytes: Buffer.byteLength(s.description),
      owner: input.originOf(s.filePath) ?? s.source,
    }))
    .filter((d) => d.bytes > DESCRIPTION_MAX_BYTES)
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return {
    ...limits,
    agentId: status.agentId,
    skills: visible.length,
    included: fitted.included,
    chars,
    headroom: limits.maxChars - chars,
    usedPct: (chars / Math.max(1, limits.maxChars)) * 100,
    format: fitted.format,
    longCount: long.length,
    longExcess: long.reduce((n, d) => n + d.bytes - DESCRIPTION_MAX_BYTES, 0),
    longest: long.slice(0, LONGEST_SHOWN),
    minContextTokens: chars * CONTEXT_TOKENS_PER_CHAR,
  };
}
