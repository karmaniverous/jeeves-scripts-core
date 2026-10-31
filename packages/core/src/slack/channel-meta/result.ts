/**
 * @module slack/channel-meta/result
 *
 * The worker's output contract: `result.json` in the run directory,
 * `{ "channels": { "<id>": { "description"?: string, "topic"?: string } } }`.
 * A file that is not JSON of that shape fails the run. Each requested
 * value is then checked on its own: a single line, not empty, within its
 * cap (counted in characters), and without Slack mentions (`<@…>`,
 * `<!…>`). A value that fails is rejected with the reason and nothing is
 * set for it; values that pass are applied. Values for channels or fields
 * that weren't requested are ignored. A broken file throws a
 * {@link WorkerResultError}: its `summary` is fixed wording and counts,
 * safe for the report; its message, the full diagnostic (the parser's
 * message quotes the file, issue paths name channel ids), is for the run
 * directory and the job log only. Pure.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';
import { z } from 'zod';

import type { MetaField } from './plan.js';

const resultSchema = z.object({
  channels: z.record(
    z.string(),
    z
      .object({
        description: z.string().optional(),
        topic: z.string().optional(),
      })
      .loose(),
  ),
});

/** A worker result that can't be used. */
export class WorkerResultError extends Error {
  /** What the report says: fixed wording and counts, never the
   * result's text or keys. */
  readonly summary: string;

  /**
   * @param summary - The report-safe summary.
   * @param detail - The full diagnostic (the error's message).
   * @param options - The cause.
   */
  constructor(summary: string, detail: string, options?: ErrorOptions) {
    super(detail, options);
    this.name = 'WorkerResultError';
    this.summary = summary;
  }
}

/** What was asked of the worker for one channel. */
export interface ResultRequest {
  /** Channel id. */
  id: string;
  /** Fields asked for. */
  fields: readonly MetaField[];
}

/** A value the script will set. */
export interface AcceptedValue<R extends ResultRequest> {
  /** The request it answers. */
  request: R;
  /** Field. */
  field: MetaField;
  /** Value, trimmed. */
  text: string;
}

/** A value the script rejected. */
export interface RejectedValue {
  /** Channel id. */
  id: string;
  /** Field. */
  field: MetaField;
  /** Why. */
  reason: string;
}

/** The checked result. */
export interface CheckedResult<R extends ResultRequest> {
  /** Values to set. */
  accepted: AcceptedValue<R>[];
  /** Values refused, or requested and missing. */
  rejected: RejectedValue[];
}

/** Caps per field. */
export type FieldCaps = Record<MetaField, number>;

/**
 * Why a value can't be set, or `undefined` when it can.
 *
 * @param text - The trimmed value.
 * @param max - Its cap in characters.
 * @returns The reason, or `undefined`.
 */
export function valueProblem(text: string, max: number): string | undefined {
  if (!text) return 'empty';
  if (/[\r\n]/.test(text)) return 'more than one line';
  // Characters are code points: a UTF-16 surrogate pair counts once.
  const length = Array.from(text).length;
  if (length > max)
    return `${String(length)} characters, over the ${String(max)} cap`;
  if (/<[@!#]/.test(text)) return 'contains a Slack mention';
  return undefined;
}

/**
 * Parse and check the worker's result.
 *
 * @param text - The result file's text.
 * @param requests - What was asked, per channel (returned with each
 *   accepted value).
 * @param caps - Caps per field.
 * @returns The accepted and rejected values.
 * @throws WorkerResultError when the text is not JSON of the contract's
 *   shape.
 */
export function checkResult<R extends ResultRequest>(
  text: string,
  requests: readonly R[],
  caps: FieldCaps,
): CheckedResult<R> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new WorkerResultError(
      "the worker's result is not valid JSON",
      `The worker's result is not JSON: ${getErrorMessage(e)}`,
      { cause: e },
    );
  }
  const parsed = resultSchema.safeParse(json);
  if (!parsed.success) {
    const { issues } = parsed.error;
    throw new WorkerResultError(
      `the worker's result does not match the contract (${String(issues.length)} issue${issues.length === 1 ? '' : 's'})`,
      `The worker's result does not match the contract: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const out: CheckedResult<R> = { accepted: [], rejected: [] };
  for (const request of requests)
    for (const field of request.fields) {
      const { id } = request;
      const raw = parsed.data.channels[id]?.[field];
      if (raw === undefined) {
        out.rejected.push({ id, field, reason: 'not written' });
        continue;
      }
      const value = raw.trim();
      const problem = valueProblem(value, caps[field]);
      if (problem === undefined)
        out.accepted.push({ request, field, text: value });
      else out.rejected.push({ id, field, reason: problem });
    }
  return out;
}
