/**
 * Tests for the mechanical proposal checks: description length, the
 * child_process scan, duplicate drafts, the live skill and the revert
 * hint, same-named skills and missing artifacts.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { checkProposal, DESCRIPTION_MAX_BYTES } from './checks.js';
import type { InventorySkill } from './inventory.js';
import type { PendingProposal } from './proposals.js';

const proposal = (over: Partial<PendingProposal> = {}): PendingProposal => ({
  id: 'p1',
  kind: 'update',
  status: 'pending',
  title: '',
  description: 'Listed description',
  skillName: 'alpha',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '',
  scanState: 'clean',
  targetSkillFile: '/skills/alpha/SKILL.md',
  artifacts: [
    {
      path: 'PROPOSAL.md',
      sizeBytes: 1,
      content: '---\nname: alpha\ndescription: Draft description\n---\n',
      source: 'store',
    },
    {
      path: 'scripts/a.cjs',
      sizeBytes: 1,
      content: "require('node:child_process')",
      source: 'store',
    },
    // Read from the gateway, not the store: readable, so not missing.
    { path: 'scripts/b.cjs', sizeBytes: 1, content: 'ok', source: 'gateway' },
    { path: 'notes.md', sizeBytes: 1, source: 'missing' },
  ],
  ...over,
});

const skill = (over: Partial<InventorySkill>): InventorySkill => ({
  name: 'alpha',
  description: 'Live description',
  origin: 'workshop',
  file: '/skills/alpha/SKILL.md',
  bytes: 1,
  text: '',
  ...over,
});

const LIVE = skill({ mtimeMs: Date.parse('2026-10-21T00:00:00Z') });
const OTHER = skill({ origin: 'jeeves', file: '/pkg/alpha/SKILL.md' });

describe('checkProposal', () => {
  it('reports every finding', () => {
    const p = proposal();
    const dup = proposal({ id: 'p2' });
    const unrelated = proposal({ id: 'p3', skillName: 'beta' });
    expect(checkProposal(p, [p, dup, unrelated], [LIVE, OTHER])).toEqual({
      draftDescription: 'Draft description',
      draftDescriptionBytes: 17,
      descriptionTooLong: false,
      childProcessFiles: ['scripts/a.cjs'],
      duplicateDrafts: ['p2'],
      liveSkillFile: LIVE.file,
      liveDescription: 'Live description',
      liveChangedAfterDraft: true,
      sameNameElsewhere: ['jeeves: /pkg/alpha/SKILL.md'],
      missingArtifacts: ['notes.md'],
    });
  });

  it('flags a description over the byte limit, counting UTF-8 bytes', () => {
    const description = 'é'.repeat(DESCRIPTION_MAX_BYTES / 2 + 1);
    const p = proposal({
      artifacts: [
        {
          path: 'PROPOSAL.md',
          sizeBytes: 1,
          content: `---\ndescription: ${description}\n---\n`,
          source: 'store',
        },
      ],
    });
    expect(checkProposal(p, [p], [])).toMatchObject({
      draftDescriptionBytes: DESCRIPTION_MAX_BYTES + 2,
      descriptionTooLong: true,
    });
  });

  it('accepts a description of exactly the limit', () => {
    const p = proposal({
      artifacts: [],
      description: 'x'.repeat(DESCRIPTION_MAX_BYTES),
    });
    expect(checkProposal(p, [p], []).descriptionTooLong).toBe(false);
  });

  it('scans only support files for child_process, not the draft', () => {
    const p = proposal({
      artifacts: [
        {
          path: 'PROPOSAL.md',
          sizeBytes: 1,
          content: 'Never use child_process here.',
          source: 'store',
        },
      ],
    });
    expect(checkProposal(p, [p], []).childProcessFiles).toEqual([]);
  });

  it('falls back to the listed description without draft text', () => {
    const p = proposal({ artifacts: [] });
    expect(checkProposal(p, [p], []).draftDescription).toBe(
      'Listed description',
    );
  });

  it.each([
    ['no target file', { targetSkillFile: undefined }, [LIVE]],
    ['an unparseable creation time', { createdAt: 'never' }, [LIVE]],
    ['a live skill without an mtime', {}, [skill({})]],
    ['an older live skill', {}, [skill({ mtimeMs: 1 })]],
    [
      'a live skill changed at the creation time',
      {},
      [skill({ mtimeMs: Date.parse('2026-10-20T00:00:00.000Z') })],
    ],
  ])('does not flag a revert with %s', (_label, over, inventory) => {
    const p = proposal(over);
    expect(checkProposal(p, [p], inventory).liveChangedAfterDraft).toBe(false);
  });

  it('prefers the exact target path over a case-folded match', () => {
    const upper = skill({ file: '/skills/Alpha/SKILL.md', description: 'U' });
    const p = proposal();
    expect(checkProposal(p, [p], [upper, LIVE]).liveSkillFile).toBe(LIVE.file);
  });

  describe('a target differing from the live path only by case', () => {
    const platform = process.platform;
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: platform });
    });

    it.each([
      ['win32', LIVE.file],
      ['linux', undefined],
    ])('on %s, matches %s', (os, expected) => {
      Object.defineProperty(process, 'platform', { value: os });
      const p = proposal({ targetSkillFile: '/skills/ALPHA/SKILL.md' });
      expect(checkProposal(p, [p], [LIVE]).liveSkillFile).toBe(expected);
    });
  });

  it('matches duplicates by skill key when present', () => {
    const p = proposal({ skillKey: 'k' });
    const sameKey = proposal({ id: 'p2', skillName: 'other', skillKey: 'k' });
    expect(checkProposal(p, [p, sameKey], []).duplicateDrafts).toEqual(['p2']);
  });
});
