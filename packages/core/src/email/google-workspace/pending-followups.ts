/**
 * @module email/google-workspace/pending-followups
 *
 * Follow-up tracking for fetched threads, in the runner store
 * (`email`/`pending`): a thread whose newest message is ours and expects
 * a reply is pending; a reply newer than our last message resolves it.
 */

import { nowIso } from '@karmaniverous/jeeves';
import type { RunnerClient } from '@karmaniverous/jeeves-runner';

import { pendingKey, shouldExpectResponse } from './email-triage.js';
import type { ParsedGmailMessage } from './gmail-message.js';

/** Insert or merge a pending follow-up entry in the runner store. */
export function upsertPending(
  client: Pick<RunnerClient, 'getItem' | 'setItem'>,
  item: Record<string, unknown>,
): void {
  const k = item.key as string;
  const existingJson = client.getItem('email', 'pending', k);
  const existing = existingJson
    ? (JSON.parse(existingJson) as Record<string, unknown>)
    : {};
  client.setItem(
    'email',
    'pending',
    k,
    JSON.stringify({ ...existing, ...item }),
  );
}

/** The newest outgoing and incoming message times of a thread. */
export interface DirectionTimes {
  latestOutMs: number | null;
  latestInMs: number | null;
  /** Subject/from/to of the newest outgoing message. */
  latestOutMeta: { subject: string; from: string; to: string } | null;
}

/** Empty direction times. */
export const noDirectionTimes = (): DirectionTimes => ({
  latestOutMs: null,
  latestInMs: null,
  latestOutMeta: null,
});

/** Fold one message into the direction times (messages without a date are ignored). */
export function trackDirection(t: DirectionTimes, p: ParsedGmailMessage): void {
  const intMs = p.internalDateMs;
  if (intMs == null) return;
  if (p.direction === 'outgoing') {
    if (t.latestOutMs == null || intMs > t.latestOutMs) {
      t.latestOutMs = intMs;
      t.latestOutMeta = { subject: p.subject, from: p.from, to: p.to };
    }
  } else if (t.latestInMs == null || intMs > t.latestInMs) t.latestInMs = intMs;
}

/** The thread facts the follow-up rule reads. */
export interface FollowUpThread {
  account: string;
  threadId: string;
  subject: string;
  from: string;
  receiptCandidate: boolean;
  junkCandidate: boolean;
}

/**
 * Mark the thread pending when our message is newest and expects a reply
 * (`shouldExpectResponse`), resolved when a reply is newer than it.
 */
export function updatePendingFollowUp(
  client: Pick<RunnerClient, 'getItem' | 'setItem'>,
  thread: FollowUpThread,
  t: DirectionTimes,
): void {
  const { account, threadId } = thread;
  const k = pendingKey(account, threadId);
  const expect = shouldExpectResponse({
    subject: thread.subject,
    from: thread.from,
    to: t.latestOutMeta?.to ?? '',
    receiptCandidate: thread.receiptCandidate,
    junkCandidate: thread.junkCandidate,
  });
  if (
    t.latestOutMs != null &&
    (t.latestInMs == null || t.latestInMs < t.latestOutMs) &&
    expect
  )
    upsertPending(client, {
      key: k,
      account,
      threadId,
      subject: (thread.subject || t.latestOutMeta?.subject) ?? '',
      from: t.latestOutMeta?.from ?? '',
      to: t.latestOutMeta?.to ?? '',
      pendingSince: new Date(t.latestOutMs).toISOString(),
      status: 'pending',
      noResponseNeeded: false,
      updatedAt: nowIso(),
    });
  if (
    t.latestOutMs != null &&
    t.latestInMs != null &&
    t.latestInMs > t.latestOutMs
  )
    upsertPending(client, {
      key: k,
      account,
      threadId,
      status: 'resolved',
      resolvedAt: nowIso(),
      updatedAt: nowIso(),
    });
}
