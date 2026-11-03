/**
 * Tests for gathering pending proposals: list and inspect through an
 * injected gateway invoker, artifact texts from the hash-matched store
 * generation, inline gateway content as the fallback, and missing ones.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { GatewayInvoker } from '../../lib/gateway-client.js';
import {
  gatherProposals,
  LIST_LIMIT,
  listPendingProposals,
} from './proposals.js';
import { memorySkillFs } from './skill-fs.test-helper.js';

const S = path.resolve('/state');
const DRAFT = '---\nname: a\n---\n# A\n';
const SCRIPT = 'console.log(1);\n';
const hash = (t: string): string =>
  createHash('sha256').update(t).digest('hex');

const listed = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'create',
  status: 'pending',
  skillName: id,
  ...extra,
});

const inspectResult = (
  artifacts: { path: string; sizeBytes: number }[],
  details: Record<string, unknown> = {},
  text = 'Proposal: x',
  contentIncluded = false,
) => ({
  content: [{ type: 'text', text }],
  details: {
    draftHash: hash(DRAFT).toUpperCase(),
    targetSkillFile: '/live/a/SKILL.md',
    inspect: { contentIncluded, availableArtifacts: artifacts },
    ...details,
  },
});

const ARTIFACTS = [
  { path: 'PROPOSAL.md', sizeBytes: Buffer.byteLength(DRAFT) },
  { path: 'scripts/run.cjs', sizeBytes: Buffer.byteLength(SCRIPT) },
];

/** An invoker answering list with `proposals` and inspect from `inspects`. */
const invoker = (
  proposals: unknown[],
  inspects: (args: Record<string, unknown>) => unknown,
) =>
  vi.fn<GatewayInvoker>((_tool, args) =>
    Promise.resolve(
      args.action === 'list'
        ? { content: [], details: { proposals } }
        : inspects(args),
    ),
  );

const genDir = (id: string, gen: string): string =>
  path.join(S, 'skill-workshop', 'proposals', id, 'generations', gen);

describe('listPendingProposals', () => {
  it('lists pending proposals at the schema limit and drops others', async () => {
    const invoke = invoker(
      [listed('a'), listed('b', { status: 'applied' })],
      () => ({}),
    );
    const out = await listPendingProposals(invoke);
    expect(out.map((p) => p.id)).toEqual(['a']);
    expect(out[0]).toMatchObject({
      title: '',
      scanState: 'unknown',
      createdAt: '',
    });
    expect(invoke).toHaveBeenCalledWith('skill_workshop', {
      action: 'list',
      status: 'pending',
      limit: LIST_LIMIT,
    });
  });

  it.each([
    ['a malformed result', { details: {} }],
    ['an unsafe id', { details: { proposals: [listed('../x')] } }],
  ])('rejects %s', async (_label, result) => {
    const invoke = vi.fn<GatewayInvoker>(() => Promise.resolve(result));
    await expect(listPendingProposals(invoke)).rejects.toThrow(
      'skill_workshop list: unexpected result',
    );
  });
});

describe('gatherProposals', () => {
  it('reads artifacts from the generation whose draft matches the hash', async () => {
    // The older generation sorts first and has same-sized texts: only the
    // hash tells them apart.
    const fs = memorySkillFs({
      [path.join(genDir('a', 'g1'), 'PROPOSAL.md')]: DRAFT.toUpperCase(),
      [path.join(genDir('a', 'g1'), 'scripts', 'run.cjs')]:
        SCRIPT.toUpperCase(),
      [path.join(genDir('a', 'g2'), 'PROPOSAL.md')]: DRAFT,
      [path.join(genDir('a', 'g2'), 'scripts', 'run.cjs')]: SCRIPT,
    });
    const invoke = invoker([listed('a')], () => inspectResult(ARTIFACTS));
    const [p] = await gatherProposals({ invoke, fs, stateDir: S });
    expect(p).toMatchObject({ id: 'a', targetSkillFile: '/live/a/SKILL.md' });
    expect(p?.artifacts).toEqual([
      { ...ARTIFACTS[0], content: DRAFT, source: 'store' },
      { ...ARTIFACTS[1], content: SCRIPT, source: 'store' },
    ]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('takes support files from inspect when several generations match the draft', async () => {
    // Only a support file changed between generations: the draft hash
    // can't tell which script is current, even at the same size.
    const fs = memorySkillFs({
      [path.join(genDir('a', 'g1'), 'PROPOSAL.md')]: DRAFT,
      [path.join(genDir('a', 'g1'), 'scripts', 'run.cjs')]:
        SCRIPT.toUpperCase(),
      [path.join(genDir('a', 'g2'), 'PROPOSAL.md')]: DRAFT,
      [path.join(genDir('a', 'g2'), 'scripts', 'run.cjs')]: SCRIPT,
    });
    const invoke = invoker([listed('a')], (args) =>
      args.artifact_path
        ? inspectResult(
            ARTIFACTS,
            {},
            `Proposal: a\n--- scripts/run.cjs ---\n${SCRIPT}`,
            true,
          )
        : inspectResult(ARTIFACTS),
    );
    const [p] = await gatherProposals({ invoke, fs, stateDir: S });
    expect(p?.artifacts.map((a) => [a.path, a.source, a.content])).toEqual([
      ['PROPOSAL.md', 'store', DRAFT],
      ['scripts/run.cjs', 'gateway', SCRIPT],
    ]);
  });

  it('falls back to inline gateway content, else marks the artifact missing', async () => {
    const fs = memorySkillFs({
      [path.join(genDir('a', 'g'), 'PROPOSAL.md')]: DRAFT,
      [path.join(genDir('a', 'g'), 'scripts', 'run.cjs')]: 'size differs',
      // Outside the generation: never read, though its size matches.
      [path.join(genDir('a', 'escape.txt'))]: 'x',
    });
    const artifacts = [
      ...ARTIFACTS,
      { path: '../escape.txt', sizeBytes: 1 },
      { path: 'notes/omitted.md', sizeBytes: 9 },
    ];
    const invoke = invoker([listed('a')], (args) => {
      const at = args.artifact_path;
      if (at === 'scripts/run.cjs')
        return inspectResult(
          artifacts,
          {},
          `Proposal: a\n--- ${at} ---\n${SCRIPT}`,
          true,
        );
      if (at === '../escape.txt')
        return inspectResult(artifacts, {}, 'no marker here', true);
      // A marker without contentIncluded is not content.
      return inspectResult(
        artifacts,
        {},
        `Proposal: a\n--- ${String(at)} ---\nlisting only`,
      );
    });
    const [p] = await gatherProposals({ invoke, fs, stateDir: S });
    expect(p?.artifacts.map((a) => [a.path, a.source, a.content])).toEqual([
      ['PROPOSAL.md', 'store', DRAFT],
      ['scripts/run.cjs', 'gateway', SCRIPT],
      ['../escape.txt', 'missing', undefined],
      ['notes/omitted.md', 'missing', undefined],
    ]);
  });

  it('marks an artifact missing when the included content lacks its marker', async () => {
    const artifacts = [{ path: 'notes/a.md', sizeBytes: 3 }];
    const invoke = invoker([listed('a')], () => ({
      // A content part without text, and none naming the artifact.
      content: [{ type: 'image' }, { type: 'text', text: 'Proposal: a' }],
      details: {
        inspect: { contentIncluded: true, availableArtifacts: artifacts },
      },
    }));
    const [p] = await gatherProposals({
      invoke,
      fs: memorySkillFs({}),
      stateDir: S,
    });
    expect(p?.artifacts).toEqual([
      { path: 'notes/a.md', sizeBytes: 3, source: 'missing' },
    ]);
  });

  it('uses inline PROPOSAL.md content when the store has no draft', async () => {
    const invoke = invoker([listed('a')], () =>
      inspectResult(
        [ARTIFACTS[0] ?? { path: '', sizeBytes: 0 }],
        { draftHash: undefined, targetSkillFile: undefined },
        `Proposal: a\n\n--- PROPOSAL.md ---\n${DRAFT}`,
        true,
      ),
    );
    const [p] = await gatherProposals({
      invoke,
      fs: memorySkillFs({}),
      stateDir: S,
    });
    expect(p?.artifacts).toEqual([
      { ...ARTIFACTS[0], content: DRAFT, source: 'gateway' },
    ]);
    expect(p).not.toHaveProperty('targetSkillFile');
    expect(p).not.toHaveProperty('draftHash');
    // The draft's text comes from the first inspect: no second call.
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('handles an inspect result without artifact details', async () => {
    const invoke = invoker([listed('a')], () => ({ details: {} }));
    const [p] = await gatherProposals({
      invoke,
      fs: memorySkillFs({}),
      stateDir: S,
    });
    expect(p?.artifacts).toEqual([]);
  });

  it('rejects a malformed inspect result', async () => {
    const invoke = invoker([listed('a')], () => ({ content: 'x' }));
    await expect(
      gatherProposals({ invoke, fs: memorySkillFs({}), stateDir: S }),
    ).rejects.toThrow('skill_workshop inspect a: unexpected result');
  });
});
