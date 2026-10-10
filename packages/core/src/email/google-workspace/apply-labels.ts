/**
 * @module email/google-workspace/apply-labels
 *
 * Label catch-up: enqueue the classification labels each thread's stored
 * state calls for but that were never enqueued (`labelApplied`), e.g.
 * threads classified while `emailConfig.reportOnly` was on. Reads thread
 * state from the runner store; writes `email-updates` items and
 * `labelApplied` through label-actions.ts, so drain-updates applies them
 * at its own rate limit. Called by the CLI's `email apply-labels`.
 */

import type { RunnerClient } from '@karmaniverous/jeeves-runner';

import {
  getThreadState,
  seenKey,
  setThreadState,
  type ThreadState,
} from '../email-state.js';
import { computeLabelsToApply } from './email-triage.js';
import { enqueueLabelActions } from './label-actions.js';

/** Runner store operations the catch-up uses. */
export type ApplyLabelsClient = Pick<
  RunnerClient,
  'getItem' | 'setItem' | 'enqueue' | 'listItemKeys'
>;

/** Default cap on threads given labels per run. */
export const APPLY_LABELS_MAX_THREADS = 500;

/** Inputs for {@link applyPendingLabels}. */
export interface ApplyLabelsOptions {
  client: ApplyLabelsClient;
  /** Gmail accounts to catch up. */
  accounts: readonly string[];
  /** Currently configured bucket names; a stored bucket outside them gets no label. */
  buckets: readonly string[];
  /** Only threads dated (else last seen) on or after this instant. */
  since?: Date;
  /** Plan only: enqueue nothing and write no state. */
  dryRun: boolean;
  /**
   * `emailConfig.reportOnly`. While it is on the run is always a dry run:
   * nothing may be written back to Gmail.
   */
  reportOnly: boolean;
  /** Stop after this many threads with pending labels (default {@link APPLY_LABELS_MAX_THREADS}). */
  maxThreads?: number;
}

/** Per-account outcome. */
export interface ApplyLabelsAccountResult {
  account: string;
  /** Threads in the account's stored state. */
  scanned: number;
  /** Threads with labels still to apply (handled this run). */
  threads: number;
  /** Labels enqueued (planned, in a dry run), by label. */
  labels: Record<string, number>;
}

/** Result of {@link applyPendingLabels}. */
export interface ApplyLabelsResult {
  /** True for a requested dry run and whenever `reportOnly` is on. */
  dryRun: boolean;
  accounts: ApplyLabelsAccountResult[];
  /** Total labels enqueued (planned, in a dry run). */
  labels: number;
  /** True when `maxThreads` stopped the run early; run again to continue. */
  truncated: boolean;
}

/**
 * Classification labels `state` calls for that were never enqueued: the
 * same rule poll uses (`receipt`, `junk`, the bucket), minus everything
 * in `labelApplied`. A bucket that is no longer configured is ignored.
 */
export const pendingLabels = (
  state: ThreadState,
  buckets: readonly string[],
): string[] =>
  computeLabelsToApply({
    receiptCandidate: state.receiptCandidate ?? false,
    junkCandidate: state.junkCandidate ?? false,
    bucket:
      state.bucket && buckets.includes(state.bucket) ? state.bucket : null,
    labelApplied: state.labelApplied,
  });

/** Milliseconds of the thread's date, else when it was last seen; NaN if neither parses. */
const threadTime = (state: ThreadState): number => {
  const date = Date.parse(state.date ?? '');
  return Number.isNaN(date) ? Date.parse(state.seenAt ?? '') : date;
};

/**
 * Enqueue every pending classification label for the given accounts and
 * record it in `labelApplied`, so a second run finds nothing to do.
 * Never touches Gmail itself: drain-updates applies the queue.
 */
export function applyPendingLabels(
  options: ApplyLabelsOptions,
): ApplyLabelsResult {
  const { client, buckets, since, reportOnly } = options;
  const dryRun = options.dryRun || reportOnly;
  const maxThreads = options.maxThreads ?? APPLY_LABELS_MAX_THREADS;
  const result: ApplyLabelsResult = {
    dryRun,
    accounts: [],
    labels: 0,
    truncated: false,
  };
  let threads = 0;

  for (const account of options.accounts) {
    const acct: ApplyLabelsAccountResult = {
      account,
      scanned: 0,
      threads: 0,
      labels: {},
    };
    result.accounts.push(acct);

    for (const threadId of client.listItemKeys('email', seenKey(account), {
      order: 'asc',
    })) {
      const state = getThreadState(client, account, threadId);
      if (!state) continue;
      acct.scanned++;
      if (since && !(threadTime(state) >= since.getTime())) continue;
      const labels = pendingLabels(state, buckets);
      if (labels.length === 0) continue;
      if (threads >= maxThreads) {
        result.truncated = true;
        break;
      }
      threads++;
      acct.threads++;
      for (const l of labels) acct.labels[l] = (acct.labels[l] ?? 0) + 1;
      result.labels += labels.length;
      if (dryRun) continue;

      const messageId = Object.keys(state.seenMessageIds ?? {})[0] ?? threadId;
      const r = enqueueLabelActions(client, {
        account,
        messageId,
        threadId,
        labels,
        source: 'apply-labels',
        reason: 'Catch-up of classification labels never applied',
        reportOnly,
      });
      setThreadState(client, account, threadId, {
        ...state,
        labelApplied: { ...(state.labelApplied ?? {}), ...r.applied },
      });
    }
    if (result.truncated) break;
  }
  return result;
}
