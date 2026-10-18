/**
 * @module respond/orchestrate
 *
 * Orchestration for email-respond (plan.ts + process.ts), with every side effect injected
 * ({@link RunDeps}) so the run logic — qualification, the hourly
 * per-thread cap, the per-run budget, retry/failure accounting, and
 * dry-run — is unit-testable without gog, the gateway, or runner
 * state.
 *
 * Flow per run:
 * 1. {@link planCandidates} qualifies every discovered candidate
 *    message (qualify.ts) that isn't already permanently handled
 *    (state.ts), recording a `skipped` state for each qualification
 *    failure.
 * 2. {@link selectForRun} orders the qualifying candidates oldest
 *    first and takes up to `maxPerRun`, honoring the per-thread hourly
 *    cap (counting replies already recorded this hour plus any made
 *    earlier in this same run).
 * 3. In `dryRun`, each selected candidate is only logged (discovery +
 *    qualification + the TASK it would dispatch): no dispatch, no
 *    send, no state write.
 * 4. Otherwise each selected candidate is dispatched to a worker
 *    session (task.ts builds the TASK and parses its
 *    contract). A dispatch exit code, parse, or send
 *    failure increments `attempts`; at {@link MAX_ATTEMPTS} the
 *    message is `failed` permanently and the run is reported as
 *    failed (its caller should exit non-zero). A success sends the
 *    reply in-thread to every original addressee, labels the thread,
 *    and records `replied` plus the thread's reply timestamp. When the
 *    mailbox shares To with others, the worker may decline instead
 *    (`declined`, recorded as `skipped`).
 *
 * Called by email/respond.ts.
 */

import type { CandidateMessage } from './candidates.js';
import {
  planCandidates,
  type PlannedCandidate,
  type PlannedSkip,
  type RunConfig,
  selectForRun,
} from './plan.js';
import { processCandidate, type RunDeps } from './process.js';

/** Summary of one run. */
export interface RunSummary {
  discovered: number;
  alreadyHandled: number;
  skipped: number;
  capped: number;
  attempted: number;
  replied: number;
  declined: number;
  failedPermanently: string[];
  failedRetrying: string[];
}

/**
 * Run one email-respond pass over already-discovered candidates.
 *
 * @throws Never — permanent failures are reported in the summary; the
 *   caller (respond.ts) decides to exit non-zero from
 *   `failedPermanently`.
 */
export async function runEmailRespond(
  config: RunConfig,
  candidates: readonly CandidateMessage[],
  deps: RunDeps,
  options: { dryRun: boolean; mailbox: string; label: string },
): Promise<RunSummary> {
  const log = deps.log ?? console.log;
  const planned = planCandidates(candidates, config, deps.getMessageState);

  const skips = planned.filter((p): p is PlannedSkip => p.kind === 'skip');
  for (const skip of skips) {
    log(`[email-respond] skip ${skip.candidate.messageId}: ${skip.reason}`);
    if (!options.dryRun) {
      deps.setMessageState(skip.candidate.messageId, {
        status: 'skipped',
        attempts: 0,
        at: deps.now(),
        threadId: skip.candidate.threadId,
        reason: skip.reason,
      });
    }
  }

  const alreadyHandled = planned.filter((p) => p.kind === 'already-handled');
  const qualifying = planned.filter(
    (p): p is PlannedCandidate => p.kind === 'candidate',
  );

  const { selected, capped } = selectForRun(
    qualifying,
    config,
    deps.threadReplyCountSince,
    Date.parse(deps.now()),
  );

  for (const item of capped) {
    log(
      `[email-respond] thread ${item.candidate.threadId} is at its hourly reply cap; ${item.candidate.messageId} held for a later run`,
    );
  }

  const summary: RunSummary = {
    discovered: candidates.length,
    alreadyHandled: alreadyHandled.length,
    skipped: skips.length,
    capped: capped.length,
    attempted: 0,
    replied: 0,
    declined: 0,
    failedPermanently: [],
    failedRetrying: [],
  };

  for (const item of selected) {
    if (options.dryRun) {
      log(
        `[dry-run] would dispatch for ${item.candidate.messageId} from ${item.sender.email} (thread ${item.candidate.threadId}, subject "${item.candidate.subject}")`,
      );
      continue;
    }
    summary.attempted++;
    const outcome = await processCandidate(
      item,
      options.mailbox,
      options.label,
      deps,
    );
    if (outcome === 'replied') summary.replied++;
    else if (outcome === 'declined') summary.declined++;
    else if (outcome === 'failed')
      summary.failedPermanently.push(item.candidate.messageId);
    else if (outcome === 'failed-retry')
      summary.failedRetrying.push(item.candidate.messageId);
  }

  return summary;
}
