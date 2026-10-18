/**
 * @module respond/plan
 *
 * Planning for an email-respond run (pure): {@link planCandidates}
 * qualifies each discovered message that isn't already permanently
 * handled, and {@link selectForRun} picks which qualifying messages are
 * processed this run: oldest first, at most `maxPerRun`, at most one per
 * thread, and none from a thread at its hourly reply cap.
 */

import type { RespondConfig } from '../../../config/pipeline-email-schema.js';
import type { ParsedAddress } from './address.js';
import type { CandidateMessage } from './candidates.js';
import { qualifyMessage } from './qualify.js';
import { isPermanentlyHandled, type MessageState } from './state.js';

/** Config fields {@link planCandidates} and {@link selectForRun} need. */
export type RunConfig = Pick<
  RespondConfig,
  'mailbox' | 'allowedSenders' | 'maxRepliesPerThreadPerHour' | 'maxPerRun'
>;

/** A candidate skipped for a reason recorded as permanent state. */
export interface PlannedSkip {
  kind: 'skip';
  candidate: CandidateMessage;
  reason: string;
}

/** A candidate already permanently handled on a prior run. */
export interface PlannedAlreadyHandled {
  kind: 'already-handled';
  candidate: CandidateMessage;
}

/** A candidate that qualifies and is eligible to be processed. */
export interface PlannedCandidate {
  kind: 'candidate';
  candidate: CandidateMessage;
  sender: ParsedAddress;
}

export type PlannedItem =
  PlannedSkip | PlannedAlreadyHandled | PlannedCandidate;

/**
 * Qualify every candidate, skipping ones already permanently handled.
 * Pure except for the injected state read.
 */
export function planCandidates(
  candidates: readonly CandidateMessage[],
  config: Pick<RunConfig, 'mailbox' | 'allowedSenders'>,
  getMessageState: (messageId: string) => MessageState | null,
): PlannedItem[] {
  return candidates.map((candidate): PlannedItem => {
    if (isPermanentlyHandled(getMessageState(candidate.messageId))) {
      return { kind: 'already-handled', candidate };
    }
    const result = qualifyMessage(candidate.headers, config);
    if (!result.qualifies) {
      return { kind: 'skip', candidate, reason: result.reason };
    }
    return { kind: 'candidate', candidate, sender: result.sender };
  });
}

/** Result of {@link selectForRun}: who gets processed, who is capped. */
export interface SelectionResult {
  /** Oldest first, at most `maxPerRun`. */
  selected: PlannedCandidate[];
  /** Qualified but skipped this run because their thread is at cap. */
  capped: PlannedCandidate[];
}

/**
 * Order qualifying candidates oldest first and take up to
 * `maxPerRun`, honoring the per-thread hourly reply cap. A thread's
 * count includes replies already recorded (within the last hour) plus
 * any candidate from the same thread already selected earlier in this
 * same pass, so two messages in one thread can't together exceed the
 * cap in one run.
 */
export function selectForRun(
  candidates: readonly PlannedCandidate[],
  config: Pick<RunConfig, 'maxRepliesPerThreadPerHour' | 'maxPerRun'>,
  threadReplyCountSince: (threadId: string, sinceMs: number) => number,
  nowMs: number,
): SelectionResult {
  const sorted = [...candidates].sort((a, b) => {
    const da = a.candidate.internalDateMs ?? 0;
    const db = b.candidate.internalDateMs ?? 0;
    return da - db;
  });
  const sinceMs = nowMs - 60 * 60 * 1000;
  const runCounts = new Map<string, number>();
  const selected: PlannedCandidate[] = [];
  const capped: PlannedCandidate[] = [];
  for (const item of sorted) {
    if (selected.length >= config.maxPerRun) break;
    const threadId = item.candidate.threadId;
    // One message per thread per run: the next one is answered on a later
    // run, against the thread as it stands then.
    if (runCounts.has(threadId)) continue;
    const already =
      threadReplyCountSince(threadId, sinceMs) + (runCounts.get(threadId) ?? 0);
    if (already >= config.maxRepliesPerThreadPerHour) {
      capped.push(item);
      continue;
    }
    runCounts.set(threadId, (runCounts.get(threadId) ?? 0) + 1);
    selected.push(item);
  }
  return { selected, capped };
}
