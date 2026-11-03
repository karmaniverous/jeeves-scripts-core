/**
 * Tests for the snapshot run directory: the files written, the index and
 * JSON contents and unique inventory paths.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GatewayInvoker } from '../../lib/gateway-client.js';
import type { ProposalChecks } from './checks.js';
import type { InventorySkill } from './inventory.js';
import { gatherProposals, type PendingProposal } from './proposals.js';
import { memorySkillFs } from './skill-fs.test-helper.js';
import { writeSnapshot } from './snapshot.js';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-snapshot-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const skill = (
  name: string,
  origin: InventorySkill['origin'],
  file: string,
) => ({
  name,
  description: `About ${name} | pipes\nand lines`,
  origin,
  file,
  bytes: 4,
  text: `# ${name}`,
});

const INVENTORY: InventorySkill[] = [
  skill('alpha', 'workshop', '/w/alpha/SKILL.md'),
  skill('alpha', 'workshop', '/w2/alpha/SKILL.md'),
  skill('my skill', 'local', '/l/x/SKILL.md'),
];

const PROPOSAL: PendingProposal = {
  id: 'alpha-1',
  kind: 'update',
  status: 'pending',
  title: '',
  description: '',
  skillName: 'alpha',
  createdAt: 'then',
  updatedAt: '',
  scanState: 'clean',
  artifacts: [
    { path: 'PROPOSAL.md', sizeBytes: 5, content: 'draft', source: 'store' },
    { path: 'scripts/x.cjs', sizeBytes: 2, content: 'js', source: 'gateway' },
    { path: 'gone.md', sizeBytes: 9, source: 'missing' },
  ],
};

const CHECKS: ProposalChecks = {
  draftDescription: 'Draft',
  draftDescriptionChars: 5,
  descriptionTooLong: true,
  childProcessFiles: ['scripts/x.cjs'],
  duplicateDrafts: [],
  liveSkillFile: '/w/alpha/SKILL.md',
  liveDescription: 'Live',
  liveChangedAfterDraft: false,
  sameNameElsewhere: [],
  missingArtifacts: ['gone.md'],
};

describe('writeSnapshot', () => {
  it('writes the index, JSON, proposal files, live skill and inventory', () => {
    const runDir = path.join(root, 'run');
    const files = writeSnapshot(
      runDir,
      [
        { proposal: PROPOSAL, checks: CHECKS },
        {
          proposal: { ...PROPOSAL, id: 'beta' },
          checks: { ...CHECKS, liveSkillFile: undefined },
        },
      ],
      INVENTORY,
    );
    expect(files).toEqual({
      runDir,
      indexFile: path.join(runDir, 'INDEX.md'),
      reportFile: path.join(runDir, 'report.md'),
    });
    const read = (...p: string[]) =>
      fs.readFileSync(path.join(runDir, ...p), 'utf8');
    expect(read('proposals', 'alpha-1', 'PROPOSAL.md')).toBe('draft');
    expect(read('proposals', 'alpha-1', 'scripts', 'x.cjs')).toBe('js');
    expect(read('proposals', 'alpha-1', 'LIVE-SKILL.md')).toBe('# alpha');
    expect(
      fs.existsSync(path.join(runDir, 'proposals', 'alpha-1', 'gone.md')),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(runDir, 'proposals', 'beta', 'LIVE-SKILL.md')),
    ).toBe(false);
    expect(read('inventory', 'workshop', 'alpha-2.md')).toBe('# alpha');
    expect(read('inventory', 'local', 'my_skill.md')).toBe('# my skill');

    const index = read('INDEX.md');
    expect(index).toContain(
      '2 pending proposal(s); 3 skill(s) in the inventory.',
    );
    expect(index).toContain('### alpha-1');
    expect(index).toContain('(9 B, MISSING)');
    expect(index).toContain('Draft description (5 chars, over 160: **yes**)');
    expect(index).toContain('Support files using child_process: scripts/x.cjs');
    expect(index).toContain('Other pending drafts for the same skill: none');
    expect(index).toContain('Live skill: none');
    expect(index).toContain('About alpha \\| pipes and lines');

    const json = JSON.parse(read('snapshot.json')) as {
      proposals: { artifacts: object[]; checks: object }[];
      inventory: object[];
    };
    expect(json.proposals[0]?.artifacts[0]).toEqual({
      path: 'PROPOSAL.md',
      sizeBytes: 5,
      source: 'store',
    });
    expect(json.proposals[0]?.checks).toEqual(CHECKS);
    expect(json.inventory[2]).toMatchObject({
      name: 'my skill',
      snapshotFile: 'inventory/local/my_skill.md',
    });
    expect(json.inventory[2]).not.toHaveProperty('text');
  });
});

describe('snapshot containment', () => {
  const TRAVERSAL = '../../../outside.md';

  it('never writes gateway content for a traversal path outside the run', async () => {
    const artifacts = [
      { path: 'PROPOSAL.md', sizeBytes: 5 },
      { path: TRAVERSAL, sizeBytes: 4 },
    ];
    const invoke = vi.fn<GatewayInvoker>((_tool, args) =>
      Promise.resolve(
        args.action === 'list'
          ? { details: { proposals: [{ ...PROPOSAL, artifacts: undefined }] } }
          : {
              content: [
                {
                  type: 'text',
                  text: `Proposal\n--- ${typeof args.artifact_path === 'string' ? args.artifact_path : 'PROPOSAL.md'} ---\nevil`,
                },
              ],
              details: {
                inspect: {
                  contentIncluded: true,
                  availableArtifacts: artifacts,
                },
              },
            },
      ),
    );
    const [p] = await gatherProposals({
      invoke,
      fs: memorySkillFs({}),
      stateDir: root,
    });
    expect(p?.artifacts[1]).toEqual({ ...artifacts[1], source: 'missing' });
    const runDir = path.join(root, 'runs', 'run');
    writeSnapshot(runDir, p ? [{ proposal: p, checks: CHECKS }] : [], []);
    const proposalDir = path.join(runDir, 'proposals', PROPOSAL.id);
    expect(fs.existsSync(path.resolve(proposalDir, TRAVERSAL))).toBe(false);
    expect(fs.readdirSync(path.join(root, 'runs'))).toEqual(['run']);
  });

  it.each([TRAVERSAL, path.resolve('/abs.md')])(
    'refuses to write an artifact at %s',
    (artifactPath) => {
      const proposal: PendingProposal = {
        ...PROPOSAL,
        artifacts: [
          { path: artifactPath, sizeBytes: 1, content: 'x', source: 'gateway' },
        ],
      };
      expect(() =>
        writeSnapshot(
          path.join(root, 'run'),
          [{ proposal, checks: CHECKS }],
          [],
        ),
      ).toThrow(`unsafe artifact path ${artifactPath}`);
    },
  );
});
