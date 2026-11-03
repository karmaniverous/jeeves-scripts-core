/**
 * @module admin/skill-review/review
 *
 * The review flow with every side effect injected:
 *
 * 1. gather: pending proposals (gateway) and the skill inventory (disk);
 *    none pending is a quiet day (`[skip]`, no snapshot, no worker): the
 *    catalog budget is still measured and a short alert posted only when
 *    it is near its budget or already cut (`budgetAlertPost`; a measuring
 *    failure only warns; previews log the alert instead of posting);
 * 2. snapshot: write both to a fresh run directory (also in dry runs:
 *    gathering is read-only) and prune old runs; measure the skills
 *    catalog budget (`skill-review/catalog-budget`; a failure only warns and the
 *    budget reads "unavailable");
 * 3. review: dispatch the worker through `dispatchWithSlack` with the
 *    TASK, no Slack posting rights of its own and the explicit dispatch
 *    flags `{ dryRun: !live, printTask }` (so the runnable's own flags
 *    never leak into it); a run without `--live`, or with `--print-task`,
 *    stops here;
 * 4. deliver: validate the worker's report, write it to
 *    `<outputDir>/<YYYY-MM-DD>.md`, re-gather to find proposals created
 *    after the review ran, and post the Slack summary the script builds
 *    from the validated report (`skill-review/slack-post`) — never the worker's
 *    own words. The budget goes in the post (two lines) and is appended
 *    to the delivered report (a full section); previews log the lines.
 */

import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import {
  dateInZone,
  deliverReport,
  reportPath,
} from '../../lib/dated-report.js';
import type { DispatcherFlags } from '../../lib/dispatcher-flags.js';
import { pruneRuns, runId } from '../../lib/run-dirs.js';
import { linkBeforeWorker, type ReportLink } from '../../lib/server-link.js';
import type { WorkerSlackResult } from '../../lib/worker-slack/worker-slack-job.js';
import type { CatalogBudget } from './catalog-budget.js';
import {
  budgetAlertPost,
  budgetReportSection,
  type BudgetResult,
  budgetSlackLines,
} from './catalog-budget-render.js';
import { checkProposal } from './checks.js';
import type { InventorySkill } from './inventory.js';
import { LIST_LIMIT, type PendingProposal } from './proposals.js';
import { reconcile } from './reconcile.js';
import { validateReport } from './report.js';
import type { SkillReviewSettings } from './settings.js';
import { buildReviewPost } from './slack-post.js';
import { writeSnapshot } from './snapshot.js';
import { buildTask } from './task.js';

/** Run directories kept after each run. */
export const KEEP_RUNS = 14;

/** Crash and skip label. */
export const SCRIPT_NAME = 'admin/review-skill-proposals';

/** The runnable's flags, as the flow reads them. */
export interface ReviewFlags {
  /** Deliver the report and post (default: a dry run). */
  live: boolean;
  /** Print the TASK; deliver and post nothing. */
  printTask: boolean;
}

/** The flow's side effects. */
export interface ReviewDeps {
  /** Resolved settings, or why they are incomplete. */
  settings: () => SkillReviewSettings | { problem: string };
  /** Pending proposals with their artifacts. */
  gatherProposals: () => Promise<PendingProposal[]>;
  /** The skill inventory. */
  readInventory: () => InventorySkill[];
  /** The skills catalog budget, owners named from the inventory. */
  catalogBudget: (
    inventory: readonly InventorySkill[],
  ) => Promise<CatalogBudget>;
  /** Directory holding run directories. */
  runsRoot: string;
  /** Clock. */
  now: () => Date;
  /** `dispatchWithSlack` bound to the job's dispatch options; the worker
   * gets no Slack posting rights (an empty Slack config). */
  dispatch: (
    task: string,
    flags: DispatcherFlags,
  ) => Promise<WorkerSlackResult>;
  /** A file's text, `undefined` when missing. */
  readText: (file: string) => string | undefined;
  /**
   * The delivered report's Slack mrkdwn insider link, resolved by
   * jeeves-server with the named machine key (`lib/server-link`).
   */
  reportLink: ReportLink;
  /** Post the script-built text to a Slack conversation as a gateway account's bot. */
  postToSlack: (
    channel: string,
    text: string,
    account: string,
  ) => Promise<void>;
  /** Output sink. */
  log: (line: string) => void;
}

/** The budget, or why it couldn't be measured (logged as a warning). */
const measureBudget = async (
  deps: ReviewDeps,
  inventory: () => readonly InventorySkill[],
): Promise<BudgetResult> => {
  try {
    return await deps.catalogBudget(inventory());
  } catch (e) {
    const problem = getErrorMessage(e);
    deps.log(
      `[warn] ${SCRIPT_NAME}: skills catalog budget unavailable: ${problem}`,
    );
    return { problem };
  }
};

/** How a run ended. */
export type ReviewOutcome = 'skipped' | 'previewed' | 'delivered' | 'alerted';

/**
 * A quiet day: measure the budget and post an alert only when one is due.
 *
 * @param preview - A dry run or `--print-task`: log, never post.
 * @param deps - Side effects.
 * @param settings - Resolved settings.
 * @returns How the run ended.
 */
const quietDay = async (
  preview: boolean,
  deps: ReviewDeps,
  settings: SkillReviewSettings,
): Promise<ReviewOutcome> => {
  deps.log(`[skip] ${SCRIPT_NAME}: no pending Workshop proposals`);
  const budget = await measureBudget(deps, deps.readInventory);
  if ('problem' in budget) return 'skipped';
  const alert = budgetAlertPost(budget, settings.budgetAlertPercent);
  if (alert === undefined) {
    deps.log(
      `${SCRIPT_NAME}: skills catalog under ${String(settings.budgetAlertPercent)}% of its budget; no alert`,
    );
    return 'skipped';
  }
  if (preview) {
    for (const line of alert.split('\n')) deps.log(`${SCRIPT_NAME}: ${line}`);
    deps.log(
      `${SCRIPT_NAME}: preview only; the alert above would go to ${settings.reportChannel}`,
    );
    return 'previewed';
  }
  await deps.postToSlack(settings.reportChannel, alert, settings.reportAccount);
  deps.log(`${SCRIPT_NAME}: skills catalog alert sent`);
  return 'alerted';
};

/**
 * Run the review.
 *
 * @param flags - `live` / `printTask`.
 * @param deps - Side effects.
 * @returns How the run ended.
 * @throws Error on incomplete settings, a gather or dispatch failure, or
 *   a missing or invalid report.
 */
export async function reviewWorkshop(
  flags: ReviewFlags,
  deps: ReviewDeps,
): Promise<ReviewOutcome> {
  const settings = deps.settings();
  if ('problem' in settings) throw new Error(settings.problem);
  const preview = !flags.live || flags.printTask;
  const proposals = await deps.gatherProposals();
  if (proposals.length === 0) return quietDay(preview, deps, settings);
  if (proposals.length >= LIST_LIMIT)
    deps.log(
      `[warn] ${SCRIPT_NAME}: ${String(proposals.length)} proposals listed (the list limit); later ones wait for the next run`,
    );
  const inventory = deps.readInventory();
  const checked = proposals.map((proposal) => ({
    proposal,
    checks: checkProposal(proposal, proposals, inventory),
  }));
  const now = deps.now();
  const snapshot = writeSnapshot(
    path.join(deps.runsRoot, runId(now)),
    checked,
    inventory,
  );
  pruneRuns(deps.runsRoot, KEEP_RUNS);
  deps.log(
    `${SCRIPT_NAME}: ${String(proposals.length)} pending proposal(s), ${String(inventory.length)} skill(s); snapshot ${snapshot.runDir}`,
  );
  const budget = await measureBudget(deps, () => inventory);
  const budgetLines = budgetSlackLines(budget);
  const date = dateInZone(now, settings.timeZone);
  const delivered = reportPath(settings.outputDir, date);
  const proposalIds = proposals.map((p) => p.id);
  // A report directory the server can't link fails the live run here,
  // before a worker is spent.
  const link = await linkBeforeWorker({
    reportLink: deps.reportLink,
    file: delivered,
    serverKeyName: settings.serverKeyName,
    preview,
    scriptName: SCRIPT_NAME,
    log: deps.log,
  });
  const task = buildTask({
    ...snapshot,
    deliveredReport: delivered,
    proposalIds,
    now,
    timeZone: settings.timeZone,
  });
  await deps.dispatch(task, {
    dryRun: !flags.live,
    printTask: flags.printTask,
  });
  if (preview) {
    for (const line of budgetLines) deps.log(`${SCRIPT_NAME}: ${line}`);
    deps.log(
      `${SCRIPT_NAME}: preview only; the report would go to ${delivered} (${settings.outputDirSource})`,
    );
    return 'previewed';
  }
  const report = deps.readText(snapshot.reportFile);
  if (report === undefined)
    throw new Error(`The worker wrote no report at ${snapshot.reportFile}`);
  const validated = validateReport(report, proposalIds);
  const file = deliverReport(
    settings.outputDir,
    date,
    `${report.trimEnd()}\n\n${budgetReportSection(budget)}`,
  );

  let nowPending: PendingProposal[] | undefined;
  try {
    nowPending = await deps.gatherProposals();
  } catch (e) {
    deps.log(
      `[warn] ${SCRIPT_NAME}: couldn't re-check the Workshop before posting; posting the review's snapshot: ${getErrorMessage(e)}`,
    );
  }
  const state = reconcile(proposals, nowPending, LIST_LIMIT);
  const post = buildReviewPost(validated, state, link, budgetLines);
  await deps.postToSlack(settings.reportChannel, post, settings.reportAccount);

  const { counts } = validated;
  deps.log(
    `${SCRIPT_NAME}: report ${file}: ${String(counts['Approve as is'])} approve as is, ${String(counts['Approve with modifications'])} approve with modifications, ${String(counts['Reject or decline'])} reject, ${String(counts['Not reviewed'] + state.revised.length + state.added.length)} not yet reviewed, ${String(state.decided)} decided since; Slack post sent`,
  );
  return 'delivered';
}
