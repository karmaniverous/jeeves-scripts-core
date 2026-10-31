/**
 * @module slack/channel-meta/refresh
 *
 * One run, with every side effect injected:
 *
 * 1. read every workspace (one per gateway Slack account) and its member
 *    channels; gather each channel read-only (`channel-meta/survey`,
 *    `channel-meta/gather`): sweep, coverage, description and topic plans;
 * 2. if any field needs text, write a snapshot of up to `maxChannels`
 *    channels, least recently processed first (`channel-meta/batch-order`; the
 *    rest wait), to the run directory and dispatch ONE
 *    worker with no Slack rights (`channel-meta/worker-batch`; `--print-task`
 *    prints the TASK instead and stops here);
 * 3. check the worker's `result.json` and set each accepted value with
 *    the channel's own workspace bot, re-reading it to verify, and record
 *    what was set (`channel-meta/apply-result`); without `--live` it checks
 *    it and stops here, setting nothing;
 * 4. write the report (`channel-meta/report`) to `<outputDir>/<YYYY-MM-DD>.md`
 *    (the date in the configured zone; the shared `lib/dated-report`)
 *    and post the numbers-only summary (`channel-meta/summary`) with the report's
 *    jeeves-server insider link (`channel-meta/post`), unless the report is the
 *    same as the last one delivered (a quiet day: nothing written or
 *    posted).
 *
 * The link and the summary's destination (`channel-meta/post`: the target and
 * the workspace whose bot posts) are found before the worker is
 * dispatched (`lib/server-link`): a live run that can't link its report directory or
 * reach its report target fails before spending a worker; a preview
 * warns. The destination's workspace decides whose generated text the
 * report shows (`channel-meta/text-scope`): only its own channels' (or
 * `slack.channelMeta.reportTextAccounts`'), every other workspace's
 * channels counted; a preview that can't reach the target shows only
 * the configured accounts' text. The state (sweep positions,
 * what was generated, last report) is saved only on a live run, and
 * before the report is delivered, so a failed post never loses the
 * record of what the job set. Previews deliver nothing: a run without
 * `--live` writes the report (each proposed value beside the current one) to
 * `preview.md` in the run directory, never the live `outputDir`, and logs
 * its path and the summary; `--print-task` logs the summary and the
 * report. A preview opens no DM (`channel-meta/post`) and deletes no run
 * directory (`channel-meta/worker-batch`). A worker result that is missing
 * or breaks the contract sets nothing and ends the run `partial`, a
 * preview too; the report and
 * summary say only what kind of failure it was, the full diagnostic
 * going to the run directory and stderr (`channel-meta/worker-batch`).
 */

import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import { dateInZone, reportPath } from '../../lib/dated-report.js';
import { runId } from '../../lib/run-dirs.js';
import { linkBeforeWorker, type ReportLink } from '../../lib/server-link.js';
import { splitBatch } from './batch-order.js';
import type { Destination, DestinationOptions } from './post.js';
import { reportBody, reportMarkdown } from './report.js';
import type { ReportInput } from './report-input.js';
import { BLOCK, type ChannelMetaSettings } from './settings.js';
import { hashText, type JobState } from './state.js';
import { summaryPost } from './summary.js';
import { surveyChannels, type SurveyDeps } from './survey.js';
import { textAccountsFor } from './text-scope.js';
import {
  type BatchDeps,
  type BatchResult,
  outcomesOf,
  runBatch,
  type RunFlags,
} from './worker-batch.js';
import type { Workspace } from './workspaces.js';

/** Crash and log label. */
export const SCRIPT_NAME = 'slack/refresh-channel-meta';

/** A preview's report file, in the run directory. */
export const PREVIEW_FILE = 'preview.md';

/** Write a preview's report into the run directory; returns the file. */
const writePreview = (runDir: string, text: string): string => {
  const file = path.join(runDir, PREVIEW_FILE);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

/** The run's side effects. */
export interface RefreshDeps extends SurveyDeps, Omit<BatchDeps, 'io'> {
  /** Settings, or why they are incomplete. */
  settings: () => ChannelMetaSettings | { problem: string };
  /** Every account's workspace. */
  workspaces: () => Promise<Workspace[]>;
  /** Load the job state. */
  loadState: () => JobState;
  /** Save the job state. */
  saveState: (state: JobState) => void;
  /** Clock. */
  now: () => Date;
  /** The report file's Slack mrkdwn insider link, resolved by
   * jeeves-server with the named machine key (the shared
   * `lib/server-link`). */
  reportLink: ReportLink;
  /** Write the report file (`lib/dated-report`); returns the file. */
  deliver: (outputDir: string, date: string, text: string) => string;
  /** Find the summary's destination (`channel-meta/post` `findDestination`). */
  destination: (
    target: string,
    account: string | undefined,
    workspaces: readonly Workspace[],
    options: DestinationOptions,
  ) => Promise<Destination>;
  /** Post the summary there (`channel-meta/post`); returns the posting account. */
  post: (text: string, destination: Destination) => Promise<string>;
  /** Log sink. */
  log: (line: string) => void;
}

/** How a run ended. */
export type RefreshOutcome = 'previewed' | 'quiet' | 'posted' | 'partial';

/**
 * Run the job once.
 *
 * @param flags - `live` / `printTask`.
 * @param deps - Side effects.
 * @returns How the run ended.
 * @throws Error on incomplete settings or invalid state.
 */
export async function refreshChannelMeta(
  flags: RunFlags,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  const settings = deps.settings();
  if ('problem' in settings) throw new Error(settings.problem);
  const preview = !flags.live || flags.printTask;
  const state = deps.loadState();
  const now = deps.now();
  const workspaces = await deps.workspaces();
  const { facts, wanted, next } = await surveyChannels(
    workspaces,
    settings,
    state,
    now,
    deps,
  );

  const date = dateInZone(now, settings.timeZone);
  const reportFile = reportPath(settings.outputDir, date);
  // A report directory the server can't link fails the live run here,
  // before a worker is spent.
  const link = await linkBeforeWorker({
    reportLink: deps.reportLink,
    file: reportFile,
    serverKeyName: settings.serverKeyName,
    preview,
    scriptName: SCRIPT_NAME,
    log: deps.log,
  });

  const findDestination = (): Promise<Destination> =>
    deps.destination(
      settings.reportChannel,
      settings.reportAccount,
      workspaces,
      { preview },
    );
  const runDir = path.join(deps.runsRoot, runId(now));
  /** Dispatch the worker and build the report for a destination. */
  const report = async (destination: Destination | undefined) => {
    const { batch, deferred } = splitBatch(wanted, state, settings.maxChannels);
    const worked: BatchResult =
      batch.length > 0
        ? await runBatch(runDir, batch, settings, flags, next, now, deps)
        : { outcomes: [] };
    const input: ReportInput = {
      date,
      preview,
      workspaces,
      facts,
      outcomes: [...outcomesOf(deferred, 'deferred'), ...worked.outcomes],
      enabled: {
        description: settings.updateDescriptions,
        topic: settings.updateTopics,
      },
      workerProblem: worked.workerProblem,
      textAccounts: textAccountsFor(
        settings.reportTextAccounts,
        destination?.ws.account,
      ),
    };
    const body = reportBody(input);
    const shown = [...input.textAccounts].join(', ') || 'none';
    deps.log(
      `${SCRIPT_NAME}: ${String(facts.length)} member channel(s) in ${String(workspaces.length)} workspace(s); ${String(wanted.length)} need text, ${String(batch.length)} sent to the worker`,
    );
    return {
      body,
      markdown: reportMarkdown(input, body),
      summary: summaryPost(input, link),
      done: worked.workerProblem === undefined,
      shown,
    };
  };

  if (preview) {
    let destination: Destination | undefined;
    try {
      destination = await findDestination();
    } catch (e) {
      deps.log(
        `[warn] ${SCRIPT_NAME}: ${getErrorMessage(e)}; the preview names and quotes no workspace's channels but those in ${BLOCK}.reportTextAccounts`,
      );
    }
    const { markdown, summary, shown, done } = await report(destination);
    // An unusable worker result fails a preview too (exit 1), so an
    // enabled job left without --live never hides a broken worker.
    const outcome = done ? 'previewed' : 'partial';
    if (flags.printTask) {
      deps.log(
        `${SCRIPT_NAME}: preview only; the report would go to ${reportFile} (${settings.outputDirSource}) and this summary to ${settings.reportChannel} (${settings.reportChannelSource}; channel text shown for: ${shown}):`,
      );
      deps.log(summary);
      deps.log(markdown);
      return outcome;
    }
    const file = writePreview(runDir, markdown);
    deps.log(
      `${SCRIPT_NAME}: preview: nothing set; report ${file} (a live run writes ${reportFile}, ${settings.outputDirSource}); this summary would go to ${settings.reportChannel} (${settings.reportChannelSource}; channel text shown for: ${shown}):`,
    );
    deps.log(summary);
    return outcome;
  }

  // A report target no bot can reach fails the live run here, before a
  // worker is spent.
  const destination = await findDestination();
  const { body, markdown, summary, done } = await report(destination);
  deps.saveState(next);
  const hash = hashText(body);
  if (hash === state.reportHash) {
    deps.log(
      `[skip] ${SCRIPT_NAME}: report unchanged since the last one delivered`,
    );
    return done ? 'quiet' : 'partial';
  }
  const file = deps.deliver(settings.outputDir, date, markdown);
  const account = await deps.post(summary, destination);
  deps.saveState({ ...next, reportHash: hash });
  deps.log(
    `${SCRIPT_NAME}: report ${file}; summary posted to ${settings.reportChannel} by ${account}`,
  );
  return done ? 'posted' : 'partial';
}
