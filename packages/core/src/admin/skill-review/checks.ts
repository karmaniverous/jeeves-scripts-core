/**
 * @module admin/skill-review/checks
 *
 * The mechanical checks the script runs on each pending proposal before
 * the worker sees it, so the worker confirms facts instead of hunting for
 * them: description length (over {@link DESCRIPTION_MAX_CHARS}), support files
 * that use `child_process` (the Workshop scanner quarantines them), other
 * pending drafts for the same skill, the live skill an update targets
 * and whether it changed after the draft was made (a revert risk), and
 * same-named skills elsewhere in the inventory. Pure.
 */

import { parseSkillFrontmatter } from './frontmatter.js';
import type { InventorySkill } from './inventory.js';
import { type PendingProposal, PROPOSAL_FILE } from './proposals.js';
import { pathKey } from './skill-fs.js';

/**
 * The longest skill description, in chars (UTF-16 code units, as the
 * catalog budget counts them). A Jeeves convention that keeps the skills
 * catalog small, not an OpenClaw limit.
 */
export const DESCRIPTION_MAX_CHARS = 160;

/** The checks' findings for one proposal. */
export interface ProposalChecks {
  /** The draft's frontmatter description (else the listed one). */
  draftDescription: string;
  /** Its length in chars (UTF-16 code units). */
  draftDescriptionChars: number;
  /** Whether it exceeds {@link DESCRIPTION_MAX_CHARS}. */
  descriptionTooLong: boolean;
  /** Support files that mention `child_process`. */
  childProcessFiles: string[];
  /** Other pending proposals for the same skill. */
  duplicateDrafts: string[];
  /** The live SKILL.md the draft targets, when it exists. */
  liveSkillFile?: string;
  /** The live skill's description. */
  liveDescription?: string;
  /** The live skill changed after the draft was created. */
  liveChangedAfterDraft: boolean;
  /** Same-named skills elsewhere (`origin: file`). */
  sameNameElsewhere: string[];
  /** Artifacts whose text could not be read. */
  missingArtifacts: string[];
}

const skillKeyOf = (p: PendingProposal): string => p.skillKey ?? p.skillName;

/**
 * Run the checks for one proposal.
 *
 * @param proposal - The proposal.
 * @param all - Every pending proposal (for duplicates).
 * @param inventory - The skill inventory.
 * @returns The findings.
 */
export function checkProposal(
  proposal: PendingProposal,
  all: readonly PendingProposal[],
  inventory: readonly InventorySkill[],
): ProposalChecks {
  const draft = proposal.artifacts.find((a) => a.path === PROPOSAL_FILE);
  const draftDescription =
    parseSkillFrontmatter(draft?.content ?? '').description ??
    proposal.description;
  const draftDescriptionChars = draftDescription.length;
  const target = proposal.targetSkillFile;
  // The exact path first; a case-folded match only where paths fold
  // (Windows), never over an exact one.
  const live =
    target === undefined
      ? undefined
      : (inventory.find((s) => s.file === target) ??
        inventory.find((s) => pathKey(s.file) === pathKey(target)));
  const created = Date.parse(proposal.createdAt);
  return {
    draftDescription,
    draftDescriptionChars,
    descriptionTooLong: draftDescriptionChars > DESCRIPTION_MAX_CHARS,
    childProcessFiles: proposal.artifacts
      .filter((a) => a.path !== PROPOSAL_FILE)
      .filter((a) => a.content?.includes('child_process'))
      .map((a) => a.path),
    duplicateDrafts: all
      .filter((p) => p.id !== proposal.id)
      .filter((p) => skillKeyOf(p) === skillKeyOf(proposal))
      .map((p) => p.id),
    ...(live
      ? { liveSkillFile: live.file, liveDescription: live.description }
      : {}),
    // An unparseable createdAt is NaN, which no mtime exceeds.
    liveChangedAfterDraft:
      live?.mtimeMs !== undefined && live.mtimeMs > created,
    sameNameElsewhere: inventory
      .filter((s) => s.name === proposal.skillName && s !== live)
      .map((s) => `${s.origin}: ${s.file}`),
    missingArtifacts: proposal.artifacts
      .filter((a) => a.source === 'missing')
      .map((a) => a.path),
  };
}
