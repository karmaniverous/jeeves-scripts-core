/**
 * @module admin/skill-review/snapshot-render
 *
 * The snapshot's layout and texts, pure: where each proposal artifact and
 * inventory skill goes in the run directory, `INDEX.md` (every proposal
 * with the script's checks, then the inventory table) and
 * `snapshot.json` (the same data without file texts). `snapshot.ts`
 * writes them.
 */

import { DESCRIPTION_MAX_CHARS, type ProposalChecks } from './checks.js';
import type { InventorySkill } from './inventory.js';
import type { PendingProposal } from './proposals.js';

/** A proposal with its checks. */
export interface CheckedProposal {
  /** The proposal and its artifacts. */
  proposal: PendingProposal;
  /** The script's checks. */
  checks: ProposalChecks;
}

/** An inventory skill and its run-directory path. */
export interface PlacedSkill {
  /** The skill. */
  skill: InventorySkill;
  /** Path relative to the run directory. */
  snapshotFile: string;
}

/** A file-name-safe version of a name. */
export const safeName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, '_') || '_';

/**
 * Each inventory skill with its unique snapshot path
 * (`inventory/<origin>/<name>.md`, `-2`, `-3`... on a clash).
 *
 * @param inventory - The inventory.
 * @returns The skills, in order, with their paths.
 */
export function placeInventory(
  inventory: readonly InventorySkill[],
): PlacedSkill[] {
  const used = new Set<string>();
  return inventory.map((skill) => {
    const base = `inventory/${skill.origin}/${safeName(skill.name)}`;
    let candidate = `${base}.md`;
    for (let n = 2; used.has(candidate); n++)
      candidate = `${base}-${String(n)}.md`;
    used.add(candidate);
    return { skill, snapshotFile: candidate };
  });
}

const cell = (text: string): string =>
  text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

const yesNo = (flag: boolean): string => (flag ? '**yes**' : 'no');

const list = (items: readonly string[]): string =>
  items.length ? items.join('; ') : 'none';

/** The INDEX.md section for one proposal. */
const proposalSection = ({ proposal: p, checks: c }: CheckedProposal): string =>
  [
    `### ${p.id}`,
    '',
    `- Kind: ${p.kind}; skill: \`${p.skillName}\`; created ${p.createdAt}; scan: ${p.scanState}`,
    `- Files: ${p.artifacts.map((a) => `\`proposals/${safeName(p.id)}/${a.path}\` (${String(a.sizeBytes)} B${a.source === 'missing' ? ', MISSING' : ''})`).join(', ')}`,
    `- Draft description (${String(c.draftDescriptionChars)} chars, over ${String(DESCRIPTION_MAX_CHARS)}: ${yesNo(c.descriptionTooLong)}): ${c.draftDescription}`,
    `- Live skill: ${c.liveSkillFile ? `\`proposals/${safeName(p.id)}/LIVE-SKILL.md\` (from ${c.liveSkillFile}); live description: ${c.liveDescription ?? ''}` : 'none'}`,
    `- Live skill changed after this draft was created: ${yesNo(c.liveChangedAfterDraft)}`,
    `- Support files using child_process: ${list(c.childProcessFiles)}`,
    `- Other pending drafts for the same skill: ${list(c.duplicateDrafts)}`,
    `- Same-named skills elsewhere: ${list(c.sameNameElsewhere)}`,
    `- Unreadable artifacts: ${list(c.missingArtifacts)}`,
  ].join('\n');

/**
 * The `INDEX.md` text.
 *
 * @param proposals - Proposals with checks.
 * @param placed - The inventory with snapshot paths.
 * @returns The Markdown.
 */
export function renderIndex(
  proposals: readonly CheckedProposal[],
  placed: readonly PlacedSkill[],
): string {
  return [
    '# Skill Workshop review snapshot',
    '',
    `${String(proposals.length)} pending proposal(s); ${String(placed.length)} skill(s) in the inventory.`,
    '',
    '## Pending proposals',
    '',
    ...proposals.map((p) => `${proposalSection(p)}\n`),
    '## Inventory',
    '',
    '| Name | Origin | Bytes | Description | File |',
    '| --- | --- | --- | --- | --- |',
    ...placed.map(
      ({ skill: s, snapshotFile }) =>
        `| ${cell(s.name)} | ${s.origin} | ${String(s.bytes)} | ${cell(s.description)} | \`${snapshotFile}\` |`,
    ),
    '',
  ].join('\n');
}

/**
 * The `snapshot.json` text: proposals with checks (artifacts without
 * their texts) and the inventory (without SKILL.md texts).
 *
 * @param proposals - Proposals with checks.
 * @param placed - The inventory with snapshot paths.
 * @returns Pretty-printed JSON with a trailing newline.
 */
export function renderJson(
  proposals: readonly CheckedProposal[],
  placed: readonly PlacedSkill[],
): string {
  const data = {
    proposals: proposals.map(({ proposal, checks }) => ({
      ...proposal,
      artifacts: proposal.artifacts.map(({ path, sizeBytes, source }) => ({
        path,
        sizeBytes,
        source,
      })),
      checks,
    })),
    inventory: placed.map(
      ({
        skill: { name, description, origin, file, bytes, mtimeMs },
        snapshotFile,
      }) => ({
        name,
        description,
        origin,
        file,
        bytes,
        mtimeMs,
        snapshotFile,
      }),
    ),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}
