/**
 * @module admin/skill-review/catalog-format
 *
 * OpenClaw's model-visible skills catalog (the `<available_skills>` block),
 * rebuilt the way OpenClaw 2026.9.6 (`eb377ac`) renders it, so the review can measure
 * it: the full and compact catalogs (`src/skills/loading/skill-contract.ts`)
 * and the prompt-facing skill location, the SKILL.md path with the home
 * directory shown as `~/` (`compactPromptSkills` in
 * `src/skills/loading/skill-paths.ts`). The port shortens every path
 * under any home it is given (`HOME`, else `USERPROFILE`, else the OS
 * home; the OS home, `os.homedir()`; and their real paths). Not ported:
 * OpenClaw shortens a managed skill path (under the agent's Workshop
 * skills directory, `<configDir>/skills` or `<configDir>/plugin-skills`,
 * or their real paths) only when it also lies under the OS home or its
 * real path, and never in a container whose OS home is `/data` with the
 * config directory at or under `/data/.openclaw`. So the port reads
 * shorter (the home prefix less the 2 chars of `~/`) for each managed
 * skill under a home outside the OS home (a `HOME` that differs from
 * `os.homedir()`), and for each managed skill in that container layout. A
 * path under no home stays absolute in both; with the config directory
 * under the OS home and no such container layout (the default) the two
 * agree. Lengths are UTF-16 code units, as OpenClaw counts them. Pure.
 */

import path from 'node:path';

/** One model-visible skill as the catalog lists it. */
export interface CatalogSkill {
  /** Skill name. */
  name: string;
  /** Description, as loaded. */
  description: string;
  /** Prompt-facing location (see {@link promptLocation}). */
  location: string;
}

/** The compact catalog's longest description. */
export const COMPACT_DESCRIPTION_MAX_CHARS = 220;

/**
 * Escape text for the catalog's XML.
 *
 * @param s - Text.
 * @returns Escaped text.
 */
export const escapeSkillXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/**
 * The first `max` UTF-16 code units, never ending on half a surrogate pair
 * (at `max` 0, `charCodeAt(-1)` is `NaN`, so nothing is backed off).
 *
 * @param s - Text longer than `max`.
 * @param max - Code units.
 * @returns The prefix.
 */
const truncateUtf16Safe = (s: string, max: number): string => {
  const end =
    isHigh(s.charCodeAt(max - 1)) && isLow(s.charCodeAt(max)) ? max - 1 : max;
  return s.slice(0, end);
};

/**
 * A description as the compact catalog shows it: whitespace collapsed,
 * cut to `maxChars` with `...` when longer.
 *
 * @param description - The description.
 * @param maxChars - The cap (at least 1).
 * @returns The shortened description.
 */
export function truncateSkillDescription(
  description: string,
  maxChars: number,
): string {
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return truncateUtf16Safe(normalized, maxChars);
  return `${truncateUtf16Safe(normalized, maxChars - 3).trimEnd()}...`;
}

const formatCatalog = (
  skills: readonly CatalogSkill[],
  loadingInstructions: string,
  descriptionFor: (skill: CatalogSkill) => string | undefined,
): string => {
  if (skills.length === 0) return '';
  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    loadingInstructions,
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ];
  for (const skill of skills) {
    lines.push('  <skill>', `    <name>${escapeSkillXml(skill.name)}</name>`);
    const description = descriptionFor(skill);
    if (description !== undefined)
      lines.push(
        `    <description>${escapeSkillXml(description)}</description>`,
      );
    lines.push(
      `    <location>${escapeSkillXml(skill.location)}</location>`,
      '  </skill>',
    );
  }
  lines.push('</available_skills>');
  return lines.join('\n');
};

/**
 * The full catalog (`formatSkillsForPromptCore`).
 *
 * @param skills - Skills, in catalog order.
 * @returns The catalog text (`''` for none).
 */
export const formatFullCatalog = (skills: readonly CatalogSkill[]): string =>
  formatCatalog(
    skills,
    "Read a skill's file at its listed location when the task matches its description.",
    (skill) => skill.description,
  );

/**
 * The compact catalog (`formatSkillsCompactForPrompt`): descriptions cut
 * to `descriptionMaxChars`, or left out at 0.
 *
 * @param skills - Skills, in catalog order.
 * @param descriptionMaxChars - The description cap.
 * @returns The catalog text (`''` for none).
 */
export const formatCompactCatalog = (
  skills: readonly CatalogSkill[],
  descriptionMaxChars: number,
): string =>
  formatCatalog(
    skills,
    descriptionMaxChars > 0
      ? "Read a skill's file at its listed location when the task matches its name or description."
      : "Read a skill's file at its listed location when the task matches its name.",
    (skill) =>
      descriptionMaxChars > 0
        ? truncateSkillDescription(skill.description, descriptionMaxChars) ||
          undefined
        : undefined,
  );

/**
 * The prefixes a home directory is matched by: with the platform
 * separator, and with `\` too for a Windows-style home.
 */
const homePrefixes = (home: string): string[] => {
  const prefixes = [home.endsWith(path.sep) ? home : home + path.sep];
  if (home.includes('\\') && !home.endsWith('\\')) prefixes.push(`${home}\\`);
  return prefixes;
};

/**
 * A SKILL.md path as the catalog shows it: under a home directory it
 * becomes `~/` plus the rest (backslashes as `/` for a Windows home);
 * anything else is unchanged. Longer homes are tried first.
 *
 * @param filePath - The absolute SKILL.md path.
 * @param homeDirs - The home directories OpenClaw resolves (absolute).
 * @returns The location.
 */
export function promptLocation(
  filePath: string,
  homeDirs: readonly string[],
): string {
  const prefixes = [...new Set(homeDirs)]
    .sort((a, b) => b.length - a.length)
    .flatMap(homePrefixes);
  for (const prefix of prefixes) {
    if (!filePath.startsWith(prefix)) continue;
    const rest = filePath.slice(prefix.length);
    return `~/${prefix.includes('\\') ? rest.replace(/\\/g, '/') : rest}`;
  }
  return filePath;
}
