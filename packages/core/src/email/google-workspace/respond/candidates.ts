/**
 * @module respond/candidates
 *
 * Candidate discovery for email-respond: search the mailbox for recent
 * inbox threads, enumerate every message in each thread (not just the
 * latest), and fetch the headers qualification needs for each.
 *
 * `gog` is injected (a `GogRunner`, same shape as gmail-search.ts) so
 * discovery is testable without a network call.
 */

import { headerValue } from '../../../lib/email.js';
import { extractPlainBody } from '../../../lib/email-html.js';
import { type GogRunner, searchThreadPages } from '../gmail-search.js';
import type { CandidateHeaders } from './qualify.js';
import {
  MessageGetResponseSchema,
  parseJsonWith,
  ThreadGetResponseSchema,
} from './schemas.js';
import type { ThreadMessage } from './task.js';

/** Gmail search query for candidate discovery. */
export const RESPOND_SEARCH_QUERY = 'in:inbox newer_than:2d';

/** Headers fetched per message for qualification. */
export const RESPOND_HEADER_NAMES = [
  'From',
  'To',
  'Cc',
  'Bcc',
  'Authentication-Results',
  'Auto-Submitted',
  'List-Id',
  'Precedence',
  'Message-ID',
  'Subject',
] as const;

/** `gog gmail thread get` args (used to enumerate message ids). */
export function threadGetArgs(mailbox: string, threadId: string): string[] {
  return ['gmail', 'thread', 'get', threadId, '--json', '--account', mailbox];
}

/** `gog gmail thread get --full` args: full bodies for the worker TASK. */
export function threadFullArgs(mailbox: string, threadId: string): string[] {
  return [...threadGetArgs(mailbox, threadId), '--full'];
}

/** `gog gmail get --format metadata` args for one message. */
export function messageMetadataArgs(
  mailbox: string,
  messageId: string,
): string[] {
  return [
    'gmail',
    'get',
    messageId,
    '--format',
    'metadata',
    '--headers',
    RESPOND_HEADER_NAMES.join(','),
    '--json',
    '--account',
    mailbox,
  ];
}

/**
 * Parse `gog gmail thread get --json` output into the thread's message
 * ids (oldest first, as Gmail returns them).
 */
export function parseThreadMessageIds(raw: string): string[] {
  if (!raw) return [];
  const parsed = parseJsonWith(
    ThreadGetResponseSchema,
    raw,
    'gog gmail thread get',
  );
  return (parsed.thread?.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** One candidate message with the headers qualification needs. */
export interface CandidateMessage {
  messageId: string;
  threadId: string;
  subject: string;
  internalDateMs: number | null;
  headers: CandidateHeaders;
}

/**
 * Parse `gog gmail get --format metadata --json` output into a
 * {@link CandidateMessage}.
 *
 * @throws When the output has no message id or thread id.
 */
export function parseCandidateMessage(raw: string): CandidateMessage {
  const parsed = parseJsonWith(
    MessageGetResponseSchema,
    raw,
    'gog gmail get metadata',
  );
  const message = parsed.message;
  const messageId = message?.id;
  const threadId = message?.threadId;
  if (!messageId || !threadId) {
    throw new Error(
      'gog gmail get metadata response missing message.id or message.threadId',
    );
  }
  const headers = message.payload?.headers ?? [];
  const authResults = headers
    .filter((h) => h.name.toLowerCase() === 'authentication-results')
    .map((h) => h.value);
  return {
    messageId,
    threadId,
    subject: headerValue(headers, 'Subject'),
    internalDateMs: message.internalDate ? Number(message.internalDate) : null,
    headers: {
      from: headerValue(headers, 'From'),
      to: headerValue(headers, 'To'),
      cc: headerValue(headers, 'Cc'),
      // Received mail rarely carries a Bcc header (most providers strip
      // it before delivery); preserve it on the rare message that does.
      bcc: headerValue(headers, 'Bcc'),
      authenticationResults: authResults,
      autoSubmitted: headerValue(headers, 'Auto-Submitted'),
      listId: headerValue(headers, 'List-Id'),
      precedence: headerValue(headers, 'Precedence'),
    },
  };
}

/**
 * Walk every search page for the candidate query, yielding deduplicated
 * thread ids as they are found (search's newest-first page order is
 * preserved; the caller decides processing order).
 *
 * @throws When gog repeats a page token.
 */
export function* discoverCandidateThreadIds(
  gog: GogRunner,
  mailbox: string,
  pageSize = 100,
): Generator<string> {
  const seen = new Set<string>();
  for (const threads of searchThreadPages(
    gog,
    mailbox,
    RESPOND_SEARCH_QUERY,
    pageSize,
  )) {
    for (const { threadId } of threads) {
      if (seen.has(threadId)) continue;
      seen.add(threadId);
      yield threadId;
    }
  }
}

/**
 * Fetch every message in a thread and parse it into a
 * {@link CandidateMessage}, dropping messages sent by the mailbox
 * itself (never a candidate: it can't be a request to the mailbox).
 */
export function fetchThreadCandidates(
  gog: GogRunner,
  mailbox: string,
  threadId: string,
): CandidateMessage[] {
  const messageIds = parseThreadMessageIds(
    gog(threadGetArgs(mailbox, threadId)),
  );
  const candidates: CandidateMessage[] = [];
  for (const messageId of messageIds) {
    const candidate = parseCandidateMessage(
      gog(messageMetadataArgs(mailbox, messageId)),
    );
    const from = candidate.headers.from.toLowerCase();
    if (
      from.includes(`<${mailbox}>`) ||
      from.trim().toLowerCase() === mailbox
    ) {
      continue;
    }
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Parse `gog gmail thread get --json` output into the thread rendered for
 * the worker TASK: sender, date and plain-text body per message, oldest
 * first (as Gmail returns them), ending at `messageId`.
 *
 * @throws Error when `messageId` is not in the thread.
 */
export function parseThreadForTask(
  raw: string,
  messageId: string,
): ThreadMessage[] {
  const parsed = parseJsonWith(
    ThreadGetResponseSchema,
    raw,
    'gog gmail thread get',
  );
  const messages = parsed.thread?.messages ?? [];
  // Only history up to and including the message being answered: a later
  // message (possibly from someone else) must never reach the worker as
  // this sender's request.
  const end = messages.findIndex((m) => m.id === messageId);
  if (end < 0) {
    throw new Error(`message ${messageId} not found in its thread`);
  }
  return messages.slice(0, end + 1).map((m) => {
    const headers = m.payload?.headers ?? [];
    return {
      from: headerValue(headers, 'From'),
      date: headerValue(headers, 'Date'),
      // text/plain, else rendered text/html: HTML-only mail (e.g. Apple
      // Mail rich links) must not reach the worker as an empty body.
      body: extractPlainBody(m.payload),
    };
  });
}
