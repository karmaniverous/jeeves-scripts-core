/**
 * @module email/google-workspace/gog-poll
 *
 * Poll one gog (Gmail) account for `email/poll`: search recent threads,
 * classify each (receipt, junk, bucket), log new and updated threads,
 * enqueue classification labels when the classification changed (unless
 * reportOnly), record thread state, and deep-fetch new or updated threads
 * that look important. Appends a per-account run summary.
 */

import path from 'node:path';

import { appendJsonl, nowIso } from '@karmaniverous/jeeves';

import { constants } from '../../lib/constants.js';
import { gogWithRetry } from '../../lib/gog.js';
import {
  type EmailStoreClient,
  getThreadState,
  loadScalarState,
  saveScalarState,
  setThreadState,
  type ThreadState,
} from '../email-state.js';
import { fetchThreadMetadata } from './email-fetch.js';
import {
  classifyBucket,
  classifyCandidates,
  computeLabelsToApply,
  looksImportantBySummary,
} from './email-triage.js';
import {
  parseSearchPage,
  searchArgs,
  type ThreadSummary,
} from './gmail-search.js';
import { enqueueLabelActions } from './label-actions.js';

/** One account poll. */
export interface GogPollContext {
  account: string;
  client: EmailStoreClient;
  /** Detect and log, but enqueue no Gmail label actions. */
  reportOnly: boolean;
  /** Gmail search query. */
  query: string;
  /** Threads per search. */
  max: number;
}

/** What polling one thread did. */
export interface ThreadPollResult {
  isNew: boolean;
  isUpdate: boolean;
  labelsEnqueued: number;
  deepFetched: boolean;
  newMessages: number;
}

/** A thread is updated when its message count grew or its date changed. */
export const isThreadUpdate = (
  prev: ThreadState | null | undefined,
  t: Pick<ThreadSummary, 'messageCount' | 'date'>,
): boolean =>
  !!prev &&
  ((t.messageCount != null &&
    prev.messageCount != null &&
    t.messageCount > prev.messageCount) ||
    (t.date != null && prev.date != null && t.date !== prev.date));

/** Poll one thread from the search page. */
export function pollThread(
  ctx: GogPollContext,
  t: ThreadSummary,
): ThreadPollResult {
  const { account, client, reportOnly, query } = ctx;
  const {
    threadId: tid,
    subject: subj,
    snippet: snip,
    from,
    to,
    date,
    messageCount: mc,
    labels,
  } = t;

  const { receiptCandidate: rc, junkCandidate: jc } = classifyCandidates(
    { subject: subj, snippet: snip, from },
    account,
  );
  const bucket = classifyBucket(account, to, subj, snip, from);
  const prev = getThreadState(client, account, tid);
  const isUpd = isThreadUpdate(prev, t);
  const eventsFile = path.join(
    constants().EMAIL_EVENTS_DIR,
    `${account}.jsonl`,
  );

  if (!prev) {
    appendJsonl(eventsFile, {
      at: nowIso(),
      kind: 'thread',
      account,
      threadId: tid,
      subject: subj,
      from,
      snippet: snip,
      date,
      messageCount: mc,
      labels,
      receiptCandidate: rc,
      junkCandidate: jc,
      bucket,
      source: 'poll',
      query,
    });
  } else if (isUpd) {
    appendJsonl(eventsFile, {
      at: nowIso(),
      kind: 'thread_update',
      account,
      threadId: tid,
      subject: subj,
      from,
      snippet: snip,
      date,
      messageCount: mc,
      labels,
      prev: {
        date: prev.date,
        messageCount: prev.messageCount,
        labels: prev.labels,
        seenAt: prev.seenAt,
      },
      receiptCandidate: rc,
      junkCandidate: jc,
      bucket,
      source: 'poll',
      query,
    });
  }

  // Determine which labels need enqueuing (new or changed classifications only)
  const classChanged =
    prev?.receiptCandidate !== rc ||
    prev.junkCandidate !== jc ||
    prev.bucket !== bucket;
  const labelApplied: Record<string, string> = {
    ...(prev?.labelApplied ?? {}),
  };
  let labelsEnqueued = 0;

  if (classChanged) {
    const msgId =
      (prev?.seenMessageIds && Object.keys(prev.seenMessageIds)[0]) ?? tid;
    const labelsToApply = computeLabelsToApply({
      receiptCandidate: rc,
      junkCandidate: jc,
      bucket,
      labelApplied,
    });

    const r = enqueueLabelActions(client, {
      account,
      messageId: msgId,
      threadId: tid,
      labels: labelsToApply,
      source: 'poll-classification',
      reason: 'Auto-label from triage classification',
      reportOnly,
    });
    Object.assign(labelApplied, r.applied);
    labelsEnqueued += r.enqueued;
  }

  setThreadState(client, account, tid, {
    ...(prev ?? {}),
    seenAt: nowIso(),
    date: date ?? undefined,
    messageCount: mc ?? undefined,
    labels,
    receiptCandidate: rc,
    junkCandidate: jc,
    bucket,
    labelApplied,
  });

  let deepFetched = false;
  let newMessages = 0;
  if (
    (!prev || isUpd) &&
    looksImportantBySummary({ labels, receiptCandidate: rc, bucket })
  ) {
    const r = fetchThreadMetadata({
      account,
      threadId: tid,
      subject: subj,
      from,
      to,
      receiptCandidate: rc,
      junkCandidate: jc,
      bucket,
      labels,
      query,
      client,
      reportOnly,
    });
    deepFetched = true;
    newMessages = r.newMessages;
  }

  return {
    isNew: !prev,
    isUpdate: isUpd,
    labelsEnqueued,
    deepFetched,
    newMessages,
  };
}

/** Poll one account and append its run summary to `_runs-{account}.jsonl`. */
export function pollGogAccount(ctx: GogPollContext): void {
  const { account, client, reportOnly, query, max } = ctx;
  const state = loadScalarState(account, client);

  const { threads } = parseSearchPage(
    gogWithRetry(searchArgs(account, query, max), {
      retries: 2,
      backoffMs: 5000,
    }),
    account,
  );
  let newC = 0,
    updC = 0,
    fetchC = 0,
    msgC = 0,
    lblC = 0;

  for (const t of threads) {
    const r = pollThread(ctx, t);
    if (r.isNew) newC++;
    else if (r.isUpdate) updC++;
    lblC += r.labelsEnqueued;
    if (r.deepFetched) fetchC++;
    msgC += r.newMessages;
  }

  saveScalarState(state, client);
  appendJsonl(
    path.join(constants().EMAIL_EVENTS_DIR, `_runs-${account}.jsonl`),
    {
      at: nowIso(),
      kind: 'poll',
      account,
      fetched: threads.length,
      new: newC,
      updated: updC,
      deepFetchedThreads: fetchC,
      newMessages: msgC,
      labelsEnqueued: lblC,
      reportOnly,
      query,
      max,
    },
  );
}
