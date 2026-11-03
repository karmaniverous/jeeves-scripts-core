/**
 * @module admin/skill-review/review-flow.test-helper
 *
 * Shared setup for the skill-review flow tests (`skill-review/review`): a temp root
 * per test, a pending proposal, a valid worker report and injected
 * {@link ReviewDeps} whose worker writes the report (or nothing) and
 * whose log and Slack posts are captured. Writes only under the temp root.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import { catalogBudgetFixture } from './catalog-budget.test-helper.js';
import type { PendingProposal } from './proposals.js';
import type { ReviewDeps, ReviewFlags } from './review.js';

/** The flow's clock. */
export const NOW = new Date('2026-10-20T23:30:00Z');

/** A live run's flags (`--live`). */
export const LIVE: ReviewFlags = { live: true, printTask: false };

/** A dry run's flags (no `--live`). */
export const DRY_RUN: ReviewFlags = { live: false, printTask: false };

/** `--print-task`'s flags. */
export const PRINT_TASK: ReviewFlags = { live: false, printTask: true };

/**
 * A pending create proposal.
 *
 * @param id - Its id (and skill name).
 * @returns The proposal.
 */
export const proposal = (id: string): PendingProposal => ({
  id,
  kind: 'create',
  status: 'pending',
  title: '',
  description: 'd',
  skillName: id,
  createdAt: '',
  updatedAt: '',
  scanState: 'clean',
  artifacts: [
    { path: 'PROPOSAL.md', sizeBytes: 1, content: 'x', source: 'store' },
  ],
});

/**
 * A valid report: the first proposal approved with modifications, the
 * rest rejected.
 *
 * @param ids - Proposal ids.
 * @returns The report.
 */
export const validReport = (ids: string[]): string =>
  ids
    .map(
      (id, i) =>
        `### ${id}\n\n**Disposition:** ${i ? 'Reject or decline' : 'Approve with modifications'}\n\n**Short description:** d-${id}\n\n**Recommendation:** r-${id}\n`,
    )
    .join('\n');

/**
 * Deps whose worker writes `report` (or nothing) to the report file.
 *
 * @param root - The test's temp root.
 * @param proposals - What the gather returns.
 * @param report - The worker's report, from the proposal ids.
 * @param over - Deps to replace.
 * @returns The deps and the captured log and posts.
 */
const reviewDeps = (
  root: string,
  proposals: PendingProposal[],
  report?: (ids: string[]) => string,
  over: Partial<ReviewDeps> = {},
) => {
  const lines: string[] = [];
  const posts: { channel: string; text: string; account: string }[] = [];
  const d: ReviewDeps = {
    settings: () => ({
      reportChannel: 'C123',
      reportAccount: 'default',
      outputDir: path.join(root, 'out'),
      outputDirSource: 'homeDir',
      timeZone: 'Asia/Makassar',
      serverKeyName: 'scripts',
      budgetAlertPercent: 90,
    }),
    gatherProposals: () => Promise.resolve(proposals),
    readInventory: () => [],
    catalogBudget: vi.fn<ReviewDeps['catalogBudget']>(() =>
      Promise.resolve(catalogBudgetFixture()),
    ),
    runsRoot: path.join(root, 'runs'),
    now: () => NOW,
    dispatch: vi.fn<ReviewDeps['dispatch']>((task, flags) => {
      const file = /to `([^`]+report\.md)`/.exec(task)?.[1] ?? '';
      if (report && !flags.dryRun && !flags.printTask)
        fs.writeFileSync(file, report(proposals.map((p) => p.id)));
      return Promise.resolve({ task, posts: [], posted: 0 });
    }),
    readText: (file) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined,
    reportLink: vi.fn<ReviewDeps['reportLink']>((file) =>
      Promise.resolve(`<link:${file}>`),
    ),
    postToSlack: (channel, text, account) => {
      posts.push({ channel, text, account });
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
    ...over,
  };
  return { d, lines, posts };
};

/**
 * Register a fresh temp root per test (removed after it).
 *
 * @returns The current test's root, and {@link reviewDeps} bound to it.
 */
export const useReviewFlow = () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-review-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    root: () => dir,
    deps: (
      proposals: PendingProposal[],
      report?: (ids: string[]) => string,
      over: Partial<ReviewDeps> = {},
    ) => reviewDeps(dir, proposals, report, over),
  };
};
