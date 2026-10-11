/**
 * @module email-fetch
 *
 * Fetch full thread metadata from Gmail, update the thread cache and
 * provenance, detect label changes, and enqueue threads for body download.
 *
 * Called by poll.ts and backfill-window.ts. Fetches via
 * `gog gmail thread get`, builds CacheMessages (gmail-message), detects
 * human label curation signals (enqueued on `email-updates` unless
 * `emailConfig.reportOnly`, via label-actions.ts), manages pending
 * follow-up tracking (pending-followups), and enqueues to `email-pending`
 * for download.
 *
 * Depends on constants().EMAIL_EVENTS_DIR for event logging and the `pipeline` config
 * bucket settings for triage decisions.
 */

import path from 'node:path';

import { appendJsonl, ensureDir, nowIso } from '@karmaniverous/jeeves';

import { constants } from '../../lib/constants.js';
import { gogWithRetry } from '../../lib/gog.js';
import { emailPeopleFields } from '../../lib/people.js';
import {
  type CacheMessage,
  createOrUpdateCache,
  detectLabelChanges,
  loadCache,
  type ProvenanceEntry,
} from '../email-cache.js';
import {
  type EmailStoreClient,
  getThreadState,
  setThreadState,
} from '../email-state.js';
import {
  addressesOf,
  type GmailMessage,
  latestInternalDateMs,
  type ParsedGmailMessage,
  parseGmailMessage,
  toCacheMessage,
} from './gmail-message.js';
import { curationSignalActions, enqueueEmailUpdates } from './label-actions.js';
import {
  noDirectionTimes,
  trackDirection,
  updatePendingFollowUp,
} from './pending-followups.js';

/** At most this many seen message ids are kept per thread (newest first). */
const MAX_SEEN_MESSAGE_IDS = 2000;

/** The thread being fetched and the poll context that found it. */
export interface FetchThreadParams {
  account: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  receiptCandidate: boolean;
  junkCandidate: boolean;
  bucket: string | null;
  labels: string[];
  query: string;
  client: EmailStoreClient;
  /** When true, curation signals are detected but not enqueued. */
  reportOnly: boolean;
}

/** Append a `message` event to `{EMAIL_EVENTS_DIR}/{account}.jsonl`. */
function appendMessageEvent(
  params: FetchThreadParams,
  p: ParsedGmailMessage,
): void {
  const { account, threadId } = params;
  ensureDir(constants().EMAIL_EVENTS_DIR);
  appendJsonl(path.join(constants().EMAIL_EVENTS_DIR, `${account}.jsonl`), {
    at: nowIso(),
    kind: 'message',
    account,
    threadId,
    messageId: p.messageId,
    internalDateMs: p.internalDateMs,
    date: p.date || null,
    subject: p.subject,
    from: p.from,
    to: p.to,
    cc: p.cc,
    ...emailPeopleFields(p),
    labels: p.labels,
    direction: p.direction,
    snippet: p.snippet,
    triage: {
      query: params.query,
      receiptCandidate: params.receiptCandidate,
      junkCandidate: params.junkCandidate,
      bucket: params.bucket,
      threadLabels: params.labels,
    },
    source: 'thread_get_metadata',
  });
}

/** Keep the most recently seen ids when over the cap. */
function pruneSeenMessageIds(
  seenMessageIds: Record<string, string>,
): Record<string, string> {
  const ids = Object.keys(seenMessageIds);
  if (ids.length <= MAX_SEEN_MESSAGE_IDS) return seenMessageIds;
  ids.sort(
    (a, b) =>
      Date.parse(seenMessageIds[b] ?? '') - Date.parse(seenMessageIds[a] ?? ''),
  );
  const pruned: Record<string, string> = {};
  for (const id of new Set(ids.slice(0, MAX_SEEN_MESSAGE_IDS))) {
    const seen = seenMessageIds[id];
    if (seen !== undefined) pruned[id] = seen;
  }
  return pruned;
}

/**
 * Fetch full thread from Gmail, update cache/provenance, detect label
 * curation, and enqueue for body download if new messages exist.
 */
export function fetchThreadMetadata(params: FetchThreadParams): {
  newMessages: number;
} {
  const { account, threadId, client } = params;
  const prevObj = getThreadState(client, account, threadId);
  const lastInternalDateMs = prevObj?.lastInternalDateMs ?? null;
  const seenMessageIds: Record<string, string> =
    prevObj?.seenMessageIds && typeof prevObj.seenMessageIds === 'object'
      ? prevObj.seenMessageIds
      : {};

  const raw = gogWithRetry(
    ['gmail', 'thread', 'get', threadId, '--json', '--account', account],
    { retries: 2, backoffMs: 5000 },
  );
  const payload = raw
    ? (JSON.parse(raw) as { thread?: { messages?: GmailMessage[] } })
    : {};
  const messages = payload.thread?.messages ?? [];
  let newMessages = 0;
  const times = noDirectionTimes();

  const participantSet = new Set<string>();
  const cacheMessages: Record<string, CacheMessage> = {};
  const provenance: ProvenanceEntry[] = [];

  for (const m of messages) {
    const p = parseGmailMessage(m, params.subject);
    if (!p) continue;
    const msgId = p.messageId;
    for (const a of addressesOf(p.from, p.to, p.cc)) participantSet.add(a);

    const cached = loadCache(account, threadId)?.messages?.[msgId]?.labels;
    if (cached) {
      provenance.push(...detectLabelChanges(cached, p.labels, msgId));
      enqueueEmailUpdates(
        client,
        curationSignalActions({
          account,
          threadId,
          messageId: msgId,
          cachedLabels: cached,
          currentLabels: p.labels,
          seenBefore: !!seenMessageIds[msgId],
        }),
        params.reportOnly,
      );
    }

    cacheMessages[msgId] = toCacheMessage(p);

    if (
      !seenMessageIds[msgId] &&
      (lastInternalDateMs == null ||
        p.internalDateMs == null ||
        p.internalDateMs > lastInternalDateMs)
    ) {
      newMessages++;
      appendMessageEvent(params, p);
    }
    seenMessageIds[msgId] = nowIso();
    trackDirection(times, p);
  }

  createOrUpdateCache({
    account,
    threadId,
    subject: params.subject,
    participants: Array.from(participantSet),
    messages: cacheMessages,
    provenance,
  });

  if (newMessages > 0)
    client.enqueue('email-pending', {
      account,
      threadId,
      subject: params.subject,
      newMessages,
      createdAt: nowIso(),
    });

  updatePendingFollowUp(client, params, times);

  setThreadState(client, account, threadId, {
    ...(prevObj ?? {}),
    lastInternalDateMs: latestInternalDateMs(messages, lastInternalDateMs),
    seenMessageIds: pruneSeenMessageIds(seenMessageIds),
    fetchedAt: nowIso(),
  });

  return { newMessages };
}
