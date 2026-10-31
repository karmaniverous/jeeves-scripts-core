/**
 * @module punch-list/harvest/run
 *
 * The harvester's body (`punch-list-harvest`):
 *
 * 1. Roll today's file over.
 * 2. Finish any undelivered harvest record from an earlier run
 *    (`record.ts`), without dispatching again.
 * 3. Fix the window: the cursor, or on the very first attempt a bootstrap
 *    start (24 hours back) saved at once so a failed first run is retried
 *    over the same window.
 * 4. When anything changed since then, dispatch the worker, validate its
 *    report, plan the Backlog merge, save the record, then deliver it
 *    (merge into Backlog, post the summary) and mark it delivered.
 * 5. Refresh the pinned quick-links message, then advance the cursor.
 *
 * `printTask` prints the task and its source and dispatches nothing;
 * without `live` it dispatches
 * the worker but writes and posts nothing.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { PunchListConfig } from '../config.js';
import { browseUrl, fileLink, markdownLink } from '../links.js';
import { harvestMessage, quickLinksText } from '../messages.js';
import { type JobDeps, type Today, todayFor } from '../runtime.js';
import { loadToday, updateToday } from '../store.js';
import { hasNewInput, readCursor, writeCursor } from './input.js';
import { type LinkFile, mergeItems } from './merge.js';
import {
  type HarvestRecord,
  recordPath,
  runFileName,
  undeliveredRecords,
  writeRecord,
} from './record.js';
import { parseReport } from './report.js';
import { buildTask, type HarvestTask } from './task.js';
import type { HarvestWorker } from './worker.js';

export interface HarvestDeps extends JobDeps {
  worker: HarvestWorker;
}

/** How `punch-list-harvest` runs. */
export interface HarvestFlags {
  /** Write the file, record and cursor and post (default: dry run). */
  live: boolean;
  /** Print the task and its source; dispatch nothing. */
  printTask: boolean;
}

/** What a run reads from its flags. */
interface RunFlags {
  dryRun: boolean;
  printTask: boolean;
}

/** One run's context. */
interface Run {
  config: PunchListConfig;
  flags: RunFlags;
  deps: HarvestDeps;
  today: Today;
  started: Date;
  link: LinkFile;
}

const DAY_MS = 86_400_000;

const reportFile = (run: Run): string =>
  join(run.config.inboxDir, runFileName(run.started));

const task = (run: Run, since: Date): HarvestTask =>
  buildTask({
    reportFile: reportFile(run),
    dir: run.config.dir,
    list: loadToday(run.today.store).list,
    since,
    now: run.started,
    timeZone: run.config.timeZone,
    inputRoots: run.config.inputRoots,
    ...(run.config.specPath ? { specPath: run.config.specPath } : {}),
  });

/** Merge a record's items into Backlog, post them, and mark the record delivered. */
const deliver = async (
  run: Run,
  file: string,
  record: HarvestRecord,
): Promise<void> => {
  const { config, flags, deps, today } = run;
  const merged = updateToday({ ...today.store, dryRun: flags.dryRun }, (list) =>
    mergeItems(list, record.report.items, run.link, today.day),
  );
  if (flags.dryRun) deps.log(merged.content);
  if (record.added.length) {
    const message = harvestMessage(
      record.added,
      record.report.summary,
      today.url,
    );
    if (flags.dryRun)
      deps.log(`[dry-run] would post to ${config.slack.channel}:\n${message}`);
    else await deps.slack().post(config.slack.channel, message);
  }
  if (!flags.dryRun) writeRecord(file, { ...record, delivered: true });
};

/** The window start, saving a bootstrap start on the first attempt. */
const windowStart = (run: Run): Date => {
  const saved = readCursor(run.config.cursorFile);
  if (saved) return saved;
  const start = new Date(run.started.getTime() - DAY_MS);
  if (!run.flags.dryRun) writeCursor(run.config.cursorFile, start);
  return start;
};

/** Dispatch, validate, plan, save the record, deliver. */
const harvest = async (run: Run, since: Date): Promise<void> => {
  const { config, deps, today } = run;
  if (!hasNewInput(config.inputRoots, since)) {
    deps.log(`no new input since ${since.toISOString()}; nothing dispatched`);
    return;
  }
  mkdirSync(config.inboxDir, { recursive: true });
  const built = task(run, since);
  deps.log(built.source);
  const report = parseReport(await deps.worker(built.text, reportFile(run)));
  const plan = mergeItems(
    loadToday(today.store).list,
    report.items,
    run.link,
    today.day,
  ).result;
  for (const s of plan.skipped) deps.log(`skipped "${s.title}": ${s.reason}`);
  deps.log(
    `worker reported ${String(report.items.length)} item(s); ${String(plan.added.length)} to add`,
  );
  const record: HarvestRecord = {
    at: run.started.toISOString(),
    since: since.toISOString(),
    report,
    added: plan.added,
    skipped: plan.skipped,
    delivered: false,
  };
  const file = recordPath(config.dir, run.started);
  if (!run.flags.dryRun) {
    writeRecord(file, record);
    rmSync(reportFile(run), { force: true });
  }
  await deliver(run, file, record);
};

/** Point the pinned quick-links message at today's file. */
const refreshPinned = async (run: Run): Promise<void> => {
  const { config, flags, deps, today } = run;
  const ts = config.slack.pinnedTs;
  if (!ts) {
    deps.log('no pinned message ts configured; quick links not updated');
    return;
  }
  const text = quickLinksText(
    today.day,
    today.url,
    config.specPath ? browseUrl(today.links, config.specPath) : undefined,
  );
  if (flags.dryRun)
    deps.log(`[dry-run] would update pinned message ${ts}:\n${text}`);
  else await deps.slack().update(config.slack.channel, ts, text);
};

/** Run the harvester once. */
export const runHarvest = async (
  config: PunchListConfig,
  { live, printTask }: HarvestFlags,
  deps: HarvestDeps,
): Promise<void> => {
  const flags: RunFlags = { dryRun: !live, printTask };
  const started = deps.now();
  const today = todayFor(config, started);
  const run: Run = {
    config,
    flags,
    deps,
    today,
    started,
    link: (p) => {
      const url = fileLink(today.links, p);
      return url ? markdownLink(url, p) : undefined;
    },
  };
  if (flags.printTask) {
    const built = task(
      run,
      readCursor(config.cursorFile) ?? new Date(started.getTime() - DAY_MS),
    );
    deps.log(built.source);
    deps.log(built.text);
    return;
  }
  updateToday({ ...today.store, dryRun: flags.dryRun }, (list) => ({
    list,
    result: null,
  }));
  for (const { file, record } of undeliveredRecords(config.dir)) {
    deps.log(`finishing undelivered harvest from ${record.at}`);
    await deliver(run, file, record);
  }
  await harvest(run, windowStart(run));
  await refreshPinned(run);
  if (!flags.dryRun) writeCursor(config.cursorFile, started);
};
