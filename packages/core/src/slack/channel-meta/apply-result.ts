/**
 * @module slack/channel-meta/apply-result
 *
 * Turn the worker's `result.json` into Slack updates: check it
 * (`channel-meta/result`), and set every accepted value that differs from the
 * channel's current one with its channel's own workspace bot
 * (`channel-meta/apply`, which re-reads to verify); a value equal to the current
 * one (after Slack's escaping and whitespace) is not written. Whoever
 * wrote the current value, the generated one replaces it. Each field
 * written and verified, or already current, is recorded in the job state
 * with the meta `_generatedAt` (and, for topics, the newest human
 * message) it came from, so the next run regenerates it only when there
 * is something new. A write Slack refuses, or one whose re-read shows a
 * different value, is `failed` and not recorded: the field keeps its
 * previous state, so the next run tries again.
 *
 * A dry run checks the result the same way but sets and records nothing:
 * {@link proposeResult} pairs each accepted value with the channel's
 * current one for the preview report.
 */

import type { ApplyOutcome } from './apply.js';
import type { ChannelFacts } from './gather.js';
import type { GenerateReason, MetaField } from './plan.js';
import { type FieldOutcome, FIELDS } from './report-input.js';
import {
  checkResult,
  type FieldCaps,
  type ResultRequest,
  WorkerResultError,
} from './result.js';
import { type JobState, normalizeSlackText } from './state.js';
import type { Workspace } from './workspaces.js';

/** A channel the worker is asked to write for. */
export interface Wanted extends ResultRequest {
  /** What the job knows about it. */
  facts: ChannelFacts;
  /** Its workspace. */
  ws: Workspace;
  /** Why each wanted field is generated. */
  reasons: Partial<Record<MetaField, GenerateReason>>;
}

/** A write whose re-read shows another value. */
export const UNVERIFIED =
  'not verified: Slack holds a different value than was sent';

/** A channel's current value of a field. */
const currentOf = (w: Wanted, field: MetaField): string =>
  field === 'description' ? w.facts.channel.purpose : w.facts.channel.topic;

/**
 * The fields a channel needs generated, if any.
 *
 * @param facts - The channel's facts.
 * @param ws - Its workspace.
 * @returns One request, or none.
 */
export function wantedOf(facts: ChannelFacts, ws: Workspace): Wanted[] {
  const reasons: Partial<Record<MetaField, GenerateReason>> = {};
  for (const field of FIELDS) {
    const plan = facts.plans[field];
    if (plan.action === 'generate') reasons[field] = plan.reason;
  }
  const fields = FIELDS.filter((f) => reasons[f] !== undefined);
  return fields.length > 0
    ? [{ id: facts.channel.id, fields, facts, ws, reasons }]
    : [];
}

/** Sets one field with a workspace's bot. */
export type ApplyFn = (
  ws: Workspace,
  channelId: string,
  field: MetaField,
  text: string,
) => Promise<ApplyOutcome>;

/** A value equal to the channel's current one (after Slack's escaping
 * and whitespace). */
const isCurrent = (w: Wanted, field: MetaField, text: string): boolean =>
  normalizeSlackText(text) === normalizeSlackText(currentOf(w, field));

/** Check the result; the rejected values as outcomes. */
const checked = (
  resultText: string | undefined,
  batch: readonly Wanted[],
  caps: FieldCaps,
) => {
  if (resultText === undefined)
    throw new WorkerResultError(
      'the worker wrote no result',
      'the worker wrote no result',
    );
  const { accepted, rejected } = checkResult(resultText, batch, caps);
  return {
    accepted,
    rejected: rejected.map((r): FieldOutcome => ({
      id: r.id,
      field: r.field,
      status: 'rejected',
      detail: r.reason,
    })),
  };
};

/**
 * Check the worker's result for a preview: each accepted value that
 * differs from the current one is `proposed` (with the current value
 * beside it and the plan's reason), one equal to it `unchanged`. Sets
 * nothing and records nothing.
 *
 * @param resultText - `result.json`'s text, `undefined` when missing.
 * @param batch - The channels the worker wrote for.
 * @param caps - Caps per field.
 * @returns What a live run would do with each requested field.
 * @throws WorkerResultError when the result is missing or breaks the
 *   contract.
 */
export function proposeResult(
  resultText: string | undefined,
  batch: readonly Wanted[],
  caps: FieldCaps,
): FieldOutcome[] {
  const { accepted, rejected } = checked(resultText, batch, caps);
  return [
    ...rejected,
    ...accepted.map(({ request: w, field, text }): FieldOutcome =>
      isCurrent(w, field, text)
        ? { id: w.id, field, status: 'unchanged', text }
        : {
            id: w.id,
            field,
            status: 'proposed',
            detail: w.reasons[field],
            text,
            current: currentOf(w, field),
          },
    ),
  ];
}

/**
 * Check the worker's result and apply it.
 *
 * @param resultText - `result.json`'s text, `undefined` when missing.
 * @param batch - The channels the worker wrote for.
 * @param caps - Caps per field.
 * @param next - The state to record set values in (mutated).
 * @param now - The run's instant.
 * @param apply - Sets one field.
 * @returns What happened to each requested field.
 * @throws WorkerResultError when the result is missing or breaks the
 *   contract.
 */
export async function applyResult(
  resultText: string | undefined,
  batch: readonly Wanted[],
  caps: FieldCaps,
  next: JobState,
  now: Date,
  apply: ApplyFn,
): Promise<FieldOutcome[]> {
  const { accepted, rejected } = checked(resultText, batch, caps);
  const outcomes = [...rejected];
  for (const { request: w, field, text } of accepted) {
    const record = (): void => {
      next.channels[w.id] = {
        ...next.channels[w.id],
        [field]: {
          generatedAt: w.facts.meta?.generatedAt,
          lastMessageTs: field === 'topic' ? w.facts.lastHumanTs : undefined,
          checkedAt: now.toISOString(),
        },
      };
    };
    if (isCurrent(w, field, text)) {
      outcomes.push({ id: w.id, field, status: 'unchanged', text });
      record();
      continue;
    }
    const res = await apply(w.ws, w.id, field, text);
    if (!res.ok || !res.verified) {
      outcomes.push({
        id: w.id,
        field,
        status: 'failed',
        detail: res.ok ? UNVERIFIED : res.code,
        text,
      });
      continue;
    }
    outcomes.push({ id: w.id, field, status: 'updated', text: res.value });
    record();
  }
  return outcomes;
}
