/**
 * @module respond/state
 *
 * Runner state for email-respond, namespace `email-respond`:
 *
 * - per-message outcome (`replied` / `failed` / `skipped`, attempts),
 *   so a message is never re-evaluated forever and a worker/send
 *   failure is retried up to {@link MAX_ATTEMPTS} times before it is
 *   recorded `failed` permanently;
 * - per-thread reply timestamps, for the hourly reply cap.
 *
 * A message that fails qualification (qualify.ts) is recorded
 * `skipped` immediately (permanent — qualification is deterministic, so
 * re-evaluating it can't change the answer). A transient discovery
 * error (a `gog` call failing) is never recorded, so the message is
 * reconsidered on a later run.
 */

import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { z } from 'zod';

import { parseJsonWith } from './schemas.js';

/** Runner state namespace for email-respond. */
export const RESPOND_NAMESPACE = 'email-respond';

/** Item-collection key for per-message outcomes. */
const MESSAGES_KEY = 'messages';

/** Item-collection key for per-thread reply timestamps. */
const THREAD_REPLIES_KEY = 'thread-replies';

/** Maximum dispatch/send attempts before a message is `failed` permanently. */
export const MAX_ATTEMPTS = 2;

/** Outcome recorded for one message (validated when read back). */
export const MessageStateSchema = z.strictObject({
  status: z.enum(['replied', 'failed', 'skipped']),
  attempts: z.number().int().min(0),
  at: z.string(),
  threadId: z.string().min(1),
  reason: z.string().optional(),
});

/** Outcome recorded for one message. */
export type MessageState = z.infer<typeof MessageStateSchema>;

/** Runner-client operations email-respond needs. */
export type RespondStoreClient = Pick<RunnerClient, 'getItem' | 'setItem'>;

/** Read a message's recorded outcome, or null when it has none. */
export function getMessageState(
  client: Pick<RunnerClient, 'getItem'>,
  messageId: string,
): MessageState | null {
  const json = client.getItem(RESPOND_NAMESPACE, MESSAGES_KEY, messageId);
  if (!json) return null;
  // Malformed state fails the run loudly rather than being treated as
  // "not handled" (which could send a second reply).
  return parseJsonWith(
    MessageStateSchema,
    json,
    `email-respond state for message ${messageId}`,
  );
}

/** Write a message's recorded outcome. */
export function setMessageState(
  client: Pick<RunnerClient, 'setItem'>,
  messageId: string,
  value: MessageState,
): void {
  client.setItem(
    RESPOND_NAMESPACE,
    MESSAGES_KEY,
    messageId,
    JSON.stringify(value),
  );
}

/**
 * Whether a message is permanently done and should never be
 * reconsidered: already replied, already recorded as a qualification
 * skip, or failed out of retries.
 */
export function isPermanentlyHandled(state: MessageState | null): boolean {
  if (!state) return false;
  if (state.status === 'replied' || state.status === 'skipped') return true;
  return state.attempts >= MAX_ATTEMPTS;
}

/** Read a thread's reply timestamps (ISO strings, oldest first). */
export function getThreadReplyTimestamps(
  client: Pick<RunnerClient, 'getItem'>,
  threadId: string,
): string[] {
  const json = client.getItem(RESPOND_NAMESPACE, THREAD_REPLIES_KEY, threadId);
  if (!json) return [];
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((ts): ts is string => typeof ts === 'string');
}

/** Number of replies to a thread since `sinceMs` (epoch ms). */
export function threadReplyCountSince(
  client: Pick<RunnerClient, 'getItem'>,
  threadId: string,
  sinceMs: number,
): number {
  return getThreadReplyTimestamps(client, threadId).filter(
    (ts) => Date.parse(ts) >= sinceMs,
  ).length;
}

/**
 * Record a reply to a thread (for the hourly cap). Keeps only
 * timestamps from the last 24 hours to bound storage.
 */
export function recordThreadReply(
  client: RespondStoreClient,
  threadId: string,
  at: string,
): void {
  const cutoff = Date.parse(at) - 24 * 60 * 60 * 1000;
  const kept = getThreadReplyTimestamps(client, threadId).filter(
    (ts) => Date.parse(ts) >= cutoff,
  );
  kept.push(at);
  client.setItem(
    RESPOND_NAMESPACE,
    THREAD_REPLIES_KEY,
    threadId,
    JSON.stringify(kept),
  );
}
