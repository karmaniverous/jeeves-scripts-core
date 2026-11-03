/**
 * Tests for the snapshot layout: unique inventory paths per skill. The
 * index and JSON texts are covered through `writeSnapshot`.
 */

import { describe, expect, it } from 'vitest';

import type { ProposalChecks } from './checks.js';
import type { InventorySkill } from './inventory.js';
import type { PendingProposal } from './proposals.js';
import { placeInventory, renderIndex } from './snapshot-render.js';

const skill = (
  name: string,
  origin: InventorySkill['origin'],
): InventorySkill => ({
  name,
  description: '',
  origin,
  file: `/${name}/SKILL.md`,
  bytes: 0,
  text: '',
});

const paths = (inventory: InventorySkill[]): string[] =>
  placeInventory(inventory).map((p) => p.snapshotFile);

describe('placeInventory', () => {
  it('suffixes clashing names', () => {
    const alpha = skill('alpha', 'workshop');
    expect(paths([alpha, alpha, skill('my skill', 'local'), alpha])).toEqual([
      'inventory/workshop/alpha.md',
      'inventory/workshop/alpha-2.md',
      'inventory/local/my_skill.md',
      'inventory/workshop/alpha-3.md',
    ]);
  });

  it('never yields an empty file name', () => {
    expect(paths([skill('', 'local')])).toEqual(['inventory/local/_.md']);
  });
});

describe('renderIndex', () => {
  const proposal: PendingProposal = {
    id: 'a b',
    kind: 'update',
    status: 'pending',
    title: '',
    description: '',
    skillName: 'alpha',
    createdAt: 'then',
    updatedAt: '',
    scanState: 'clean',
    artifacts: [],
  };
  const checks: ProposalChecks = {
    draftDescription: 'Draft',
    draftDescriptionBytes: 5,
    descriptionTooLong: false,
    childProcessFiles: [],
    duplicateDrafts: [],
    liveSkillFile: '/w/alpha/SKILL.md',
    liveDescription: 'Live one',
    liveChangedAfterDraft: true,
    sameNameElsewhere: [],
    missingArtifacts: [],
  };
  const liveLine = (c: ProposalChecks): string | undefined =>
    renderIndex([{ proposal, checks: c }], [])
      .split('\n')
      .find((l) => l.startsWith('- Live skill:'));

  it('names the live skill copy, its source and its description', () => {
    expect(liveLine(checks)).toBe(
      '- Live skill: `proposals/a_b/LIVE-SKILL.md` (from /w/alpha/SKILL.md); live description: Live one',
    );
  });

  it('leaves the live description empty when the live skill has none', () => {
    expect(liveLine({ ...checks, liveDescription: undefined })).toBe(
      '- Live skill: `proposals/a_b/LIVE-SKILL.md` (from /w/alpha/SKILL.md); live description: ',
    );
  });
});
