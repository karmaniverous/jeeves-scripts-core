/**
 * @module respond/process
 *
 * Handles one qualifying message ({@link processCandidate}), with every
 * side effect injected ({@link RunDeps}): fetch the thread up to the
 * message and check it ends with the sender's message, dispatch the
 * worker TASK, parse its contract, send the reply in-thread to every
 * original addressee (recipients.ts), label the thread, and record the
 * outcome, then mirror the reply to Slack (slack-mirror.ts; best effort,
 * never affects the email outcome). When the mailbox shares To with others
 * the worker may decline (`email-no-reply`): recorded as `skipped`,
 * nothing sent, nothing mirrored. Dispatch,
 * contract and send failures increment `attempts`; at
 * {@link MAX_ATTEMPTS} the message is `failed` permanently.
 */

import { parseFirstAddress } from './address.js';
import type { PlannedCandidate } from './plan.js';
import { addressingOf, buildReplyRecipients } from './recipients.js';
import type { MirrorPostInput } from './slack-mirror.js';
import { MAX_ATTEMPTS, type MessageState } from './state.js';
import {
  buildRespondTask,
  parseReplyContract,
  type ThreadMessage,
} from './task.js';

/** Injected side effects for {@link processCandidate}. */
export interface RunDeps {
  getMessageState: (messageId: string) => MessageState | null;
  setMessageState: (messageId: string, value: MessageState) => void;
  threadReplyCountSince: (threadId: string, sinceMs: number) => number;
  recordThreadReply: (threadId: string, at: string) => void;
  /** The thread up to and including `messageId`, oldest first. */
  fetchThread: (threadId: string, messageId: string) => ThreadMessage[];
  /** Dispatch the TASK to a worker session. */
  dispatch: (task: string) => Promise<{ exitCode: number; stdout: string }>;
  /** Read the worker's final reply text from a completed dispatch. */
  readFinalText: (stdout: string) => Promise<string | null>;
  /** Send the reply in-thread to these recipients; throws on failure. */
  sendReply: (args: {
    to: string[];
    cc: string[];
    bcc: string[];
    replyToMessageId: string;
    body: string;
  }) => void;
  /** Ensure the reply label exists, creating it if necessary. */
  ensureLabel: (label: string) => void;
  /** Apply the reply label to the thread. */
  applyLabel: (threadId: string, label: string) => void;
  /**
   * Mirror a sent reply to Slack. Optional (absent = no mirror); errors
   * are logged and never change the email outcome.
   */
  mirrorToSlack?: (
    args: MirrorPostInput & { slackChannel?: string },
  ) => Promise<string>;
  /** Current time as an ISO string. */
  now: () => string;
  log?: (line: string) => void;
}

/** Outcome of processing one candidate (for the run summary). */
export type ProcessOutcome =
  'replied' | 'declined' | 'failed' | 'failed-retry' | 'dry-run';

/**
 * Process one selected candidate: dispatch, parse, send, label, record.
 * A failure at any stage (dispatch exit code, worker contract, send)
 * increments the message's attempt count; at {@link MAX_ATTEMPTS} it is
 * recorded `failed` permanently, otherwise `failed` with attempts still
 * below the limit (retried on a later run).
 */
export async function processCandidate(
  item: PlannedCandidate,
  mailbox: string,
  label: string,
  deps: RunDeps,
): Promise<ProcessOutcome> {
  const log = deps.log ?? console.log;
  const { candidate, sender } = item;
  const priorAttempts =
    deps.getMessageState(candidate.messageId)?.attempts ?? 0;

  const fail = (reason: string): ProcessOutcome => {
    const attempts = priorAttempts + 1;
    const permanent = attempts >= MAX_ATTEMPTS;
    deps.setMessageState(candidate.messageId, {
      status: 'failed',
      attempts,
      at: deps.now(),
      threadId: candidate.threadId,
      reason,
    });
    log(
      `[email-respond] ${permanent ? 'PERMANENT FAILURE' : 'failure, will retry'} on ${candidate.messageId} (attempt ${String(attempts)}/${String(MAX_ATTEMPTS)}): ${reason}`,
    );
    return permanent ? 'failed' : 'failed-retry';
  };

  let thread: ThreadMessage[];
  try {
    thread = deps.fetchThread(candidate.threadId, candidate.messageId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`fetching thread failed: ${msg}`);
  }
  // The worker treats the last message as this sender's request, so it
  // must be the message that qualified.
  const last = thread.at(-1);
  if (!last || parseFirstAddress(last.from)?.email !== sender.email) {
    return fail(
      'thread does not end with the qualifying message from the sender',
    );
  }
  const addressing = addressingOf(candidate.headers, mailbox);
  const recipients = buildReplyRecipients(
    candidate.headers,
    sender.email,
    mailbox,
  );
  const task = buildRespondTask({
    mailbox,
    senderName: sender.name,
    senderEmail: sender.email,
    subject: candidate.subject,
    thread,
    addressing,
    recipients,
    slackMirror: deps.mirrorToSlack !== undefined,
  });

  let dispatchResult: { exitCode: number; stdout: string };
  try {
    dispatchResult = await deps.dispatch(task);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`dispatch threw: ${msg}`);
  }
  if (dispatchResult.exitCode !== 0) {
    return fail(`worker exited ${String(dispatchResult.exitCode)}`);
  }

  let finalText: string | null;
  try {
    finalText = await deps.readFinalText(dispatchResult.stdout);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`reading worker reply failed: ${msg}`);
  }
  if (!finalText) {
    return fail('worker produced no final reply text');
  }

  const contract = parseReplyContract(finalText, {
    allowNoReply: addressing === 'shared',
  });
  if (!contract.ok) {
    return fail(`worker reply contract invalid: ${contract.reason}`);
  }
  if (contract.kind === 'no-reply') {
    deps.setMessageState(candidate.messageId, {
      status: 'skipped',
      attempts: priorAttempts + 1,
      at: deps.now(),
      threadId: candidate.threadId,
      reason: `worker declined: ${contract.reason}`,
    });
    log(
      `[email-respond] worker declined to reply to ${candidate.messageId}: ${contract.reason}`,
    );
    return 'declined';
  }

  try {
    deps.sendReply({
      ...recipients,
      replyToMessageId: candidate.messageId,
      body: contract.body,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`send failed: ${msg}`);
  }

  try {
    deps.ensureLabel(label);
    deps.applyLabel(candidate.threadId, label);
  } catch (err: unknown) {
    // The reply was sent; a labeling failure must not look like the
    // reply never happened (that would risk a second reply on retry).
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `[email-respond] reply sent but labeling failed for ${candidate.messageId}: ${msg}`,
    );
  }

  const at = deps.now();
  deps.setMessageState(candidate.messageId, {
    status: 'replied',
    attempts: priorAttempts + 1,
    at,
    threadId: candidate.threadId,
  });
  deps.recordThreadReply(candidate.threadId, at);
  log(
    `[email-respond] replied in thread ${candidate.threadId} to ${[...recipients.to, ...recipients.cc, ...recipients.bcc].join(', ')}`,
  );

  if (deps.mirrorToSlack) {
    try {
      const result = await deps.mirrorToSlack({
        subject: candidate.subject,
        senderEmail: sender.email,
        recipients,
        body: contract.body,
        ...(contract.slackChannel
          ? { slackChannel: contract.slackChannel }
          : {}),
      });
      log(`[email-respond] slack mirror for ${candidate.messageId}: ${result}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `[email-respond] slack mirror failed for ${candidate.messageId} (email already sent): ${msg}`,
      );
    }
  }
  return 'replied';
}
