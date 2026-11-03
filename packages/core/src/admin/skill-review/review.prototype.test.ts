/**
 * The hoist's acceptance bar (spec 2.11, Tests: end-to-end): on the same
 * input the review flow matches the instance prototype it was hoisted
 * from: the same delivered report, post texts, log lines, dispatch flags
 * and outcome (`review.prototype.fixtures`), modulo the documented
 * renames. Scenarios: a live run (all four dispositions, a measured
 * budget), a re-gather that changed or failed, a missing report, a dry
 * run, `--print-task`, and quiet days under and over the alert threshold,
 * dry, and with the budget unmeasurable. A multibyte description counts
 * in chars, as the prototype counted it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { analyzeCatalogBudget, type SkillsStatus } from './catalog-budget.js';
import type { PendingProposal } from './proposals.js';
import { type ReviewDeps, reviewWorkshop } from './review.js';
import {
  MULTIBYTE,
  PROTOTYPE_OUTPUTS,
  type PrototypeOutput,
} from './review.prototype.fixtures.js';

const NOW = new Date('2026-10-20T03:04:05Z');
const LONG = `Use this skill to ${'\u00e9'.repeat(80)}`;

const proposal = (id: string): PendingProposal => ({
  id,
  kind: 'create',
  status: 'pending',
  title: `Title ${id}`,
  description: id === 'p-2' ? LONG : `Description of ${id} <b>&</b>`,
  skillName: `skill-${id}`,
  createdAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-19T00:00:00Z',
  scanState: 'clean',
  draftHash: `hash-${id}`,
  artifacts: [
    {
      path: 'PROPOSAL.md',
      sizeBytes: 20,
      content: `---\nname: skill-${id}\ndescription: ${id === 'p-2' ? LONG : 'short'}\n---\nBody`,
      source: 'store',
    },
    ...(id === 'p-3'
      ? [
          {
            path: 'scripts/run.js',
            sizeBytes: 40,
            content: "require('child_process').exec('x')",
            source: 'store' as const,
          },
        ]
      : []),
  ],
});

const DISPOSITIONS = [
  'Approve as is',
  'Approve with modifications',
  'Reject or decline',
  'Not reviewed',
];
const report = (ids: string[]): string =>
  ids
    .map(
      (id, i) =>
        `### ${id}\n\n**Disposition:** ${DISPOSITIONS[i % 4] ?? ''}\n\n**Short description:** short <${id}> & *bold*\n\n**Recommendation:** do the thing for ${id} @here\n`,
    )
    .join('\n');

const description = (i: number, multibyte: boolean): string => {
  if (i === 3) return multibyte ? '\u00fc'.repeat(120) : 'u'.repeat(240);
  return i === 5 ? 'x'.repeat(400) : `skill ${String(i)}`;
};

const status = (multibyte: boolean): SkillsStatus => ({
  agentId: 'main',
  skills: Array.from({ length: 12 }, (_, i) => ({
    name: `s${String(i).padStart(2, '0')}`,
    description: description(i, multibyte),
    filePath: path.join(
      os.homedir(),
      '.openclaw',
      'skills',
      `s${String(i)}`,
      'SKILL.md',
    ),
    source: 'openclaw-managed',
    modelVisible: i !== 7,
  })),
});

interface Scenario {
  proposals: string[];
  regather?: 'fail' | 'changed';
  report?: boolean;
  live: boolean;
  printTask?: boolean;
  budget: 'measured' | 'fail' | 'tight';
}

const SCENARIOS: Record<string, Scenario> = {
  'live, four proposals, measured budget': {
    proposals: ['p-1', 'p-2', 'p-3', 'p-4'],
    report: true,
    live: true,
    budget: 'measured',
  },
  'live, re-gather changed': {
    proposals: ['p-1', 'p-2', 'p-3'],
    regather: 'changed',
    report: true,
    live: true,
    budget: 'measured',
  },
  'live, re-gather fails, budget fails': {
    proposals: ['p-1', 'p-2'],
    regather: 'fail',
    report: true,
    live: true,
    budget: 'fail',
  },
  'live, missing report': {
    proposals: ['p-1'],
    report: false,
    live: true,
    budget: 'measured',
  },
  'dry run': { proposals: ['p-1', 'p-2'], live: false, budget: 'measured' },
  'print task': {
    proposals: ['p-1'],
    live: false,
    printTask: true,
    budget: 'measured',
  },
  'quiet day under threshold': {
    proposals: [],
    live: true,
    budget: 'measured',
  },
  'quiet day over threshold': { proposals: [], live: true, budget: 'tight' },
  'quiet day over threshold, dry run': {
    proposals: [],
    live: false,
    budget: 'tight',
  },
  'quiet day, budget fails': { proposals: [], live: true, budget: 'fail' },
};

/** The second gather: as the first, failed, or one revised, one decided and one new. */
const regather = (s: Scenario, props: PendingProposal[]) => {
  if (s.regather === 'fail') return Promise.reject(new Error('gateway down'));
  if (s.regather !== 'changed') return Promise.resolve(props);
  const [, revised, kept] = props;
  return Promise.resolve([
    ...(revised
      ? [{ ...revised, updatedAt: '2026-10-20T09:00:00Z', draftHash: 'new' }]
      : []),
    ...(kept ? [kept] : []),
    proposal('p-9'),
  ]);
};

/** Run core's flow on a scenario; paths as `<root>` and `<run>`. */
async function run(s: Scenario, multibyte = false): Promise<PrototypeOutput> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-review-proto-'));
  const out: PrototypeOutput = {
    outcome: '',
    delivered: null,
    posts: [],
    lines: [],
    dispatched: [],
  };
  const props = s.proposals.map(proposal);
  let gathers = 0;
  const outputDir = path.join(root, 'out');
  const deps: ReviewDeps = {
    settings: () => ({
      reportChannel: 'C123',
      reportAccount: 'default',
      outputDir,
      outputDirSource: 'homeDir',
      timeZone: 'Asia/Makassar',
      serverKeyName: 'scripts',
      budgetAlertPercent: 90,
    }),
    gatherProposals: () =>
      ++gathers === 1 ? Promise.resolve(props) : regather(s, props),
    readInventory: () => [],
    catalogBudget: () =>
      s.budget === 'fail'
        ? Promise.reject(new Error('gateway closed'))
        : Promise.resolve(
            analyzeCatalogBudget({
              status: status(multibyte),
              openclawConfig:
                s.budget === 'tight'
                  ? { skills: { limits: { maxSkillsPromptChars: 2_600 } } }
                  : {},
              homeDirs: [os.homedir()],
              originOf: () => 'jeeves',
            }),
          ),
    runsRoot: path.join(root, 'runs'),
    now: () => NOW,
    dispatch: (task, flags) => {
      out.dispatched.push(flags);
      const file = /to `([^`]+report\.md)`/.exec(task)?.[1] ?? '';
      if (s.report && !flags.dryRun && !flags.printTask)
        fs.writeFileSync(file, report(props.map((p) => p.id)));
      return Promise.resolve({ task, posts: [], posted: 0 });
    },
    readText: (file) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined,
    reportLink: (file) => Promise.resolve(`<link:${path.basename(file)}>`),
    postToSlack: (_channel, text) => {
      out.posts.push(text);
      return Promise.resolve();
    },
    log: (line) => out.lines.push(line),
  };
  const fwd = root.replace(/\\/g, '/');
  const norm = (t: string) =>
    t
      .replace(/\\/g, '/')
      .split(fwd)
      .join('<root>')
      .replace(/\d{8}-\d{6}/g, '<run>');
  try {
    out.outcome = await reviewWorkshop(
      { live: s.live, printTask: !!s.printTask },
      deps,
    );
  } catch (e) {
    out.outcome = { threw: norm(e instanceof Error ? e.message : String(e)) };
  }
  const file = path.join(outputDir, '2026-10-20.md');
  out.delivered = fs.existsSync(file)
    ? norm(fs.readFileSync(file, 'utf8'))
    : null;
  fs.rmSync(root, { recursive: true, force: true });
  return { ...out, posts: out.posts.map(norm), lines: out.lines.map(norm) };
}

describe('the review flow against the prototype', () => {
  it('covers every recorded scenario', () => {
    expect(Object.keys(SCENARIOS)).toEqual(Object.keys(PROTOTYPE_OUTPUTS));
  });

  it.each(Object.entries(SCENARIOS))('%s', async (name, s) => {
    expect(await run(s)).toEqual(PROTOTYPE_OUTPUTS[name]);
  });

  it('matches it on a multibyte description, counting chars', async () => {
    const s = SCENARIOS['live, four proposals, measured budget'];
    if (s === undefined) throw new Error('no scenario');
    const [post] = (await run(s, true)).posts;
    // 120 two-byte chars (240 bytes) are under 160 chars: only `s05` is long.
    expect(post).toBe(MULTIBYTE.prototypePost);
  });
});
