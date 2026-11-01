/**
 * @module slack/channel-meta/plan
 *
 * Decide, per channel and field, whether the job generates a new
 * description or topic, and why not when it doesn't. Pure.
 *
 * Both fields need a configured home directory that exists with a seeded
 * meta; without one the channel is reported, never updated. Then:
 *
 * - **empty** current value: generate;
 * - **new**: the job has never generated this field for the channel:
 *   generate (whoever wrote the current value);
 * - **stale**: the meta's `_generatedAt` is newer than the one the job
 *   last generated from (topics also when a person has posted since):
 *   generate;
 * - else **fresh**: nothing new to say, left alone.
 *
 * There is no protection of hand-written values: whatever is generated is
 * written when it differs from the current value (`channel-meta/apply-result`).
 * Topics also need human activity in the window: a quiet channel has
 * nothing new for its topic, so it is left alone. A field whose update is
 * switched off, or whose write scope the token lacks, is never generated.
 */

import { compareTs } from './messages.js';
import type { ChannelMetaEntity } from './meta.js';
import type { FieldState } from './state.js';

/** The two fields. */
export type MetaField = 'description' | 'topic';

/** Why a field is generated. */
export type GenerateReason = 'empty' | 'new' | 'stale';

/** Why a field is left alone. */
export type SkipReason =
  | 'disabled'
  | 'no-home-dir'
  | 'home-dir-missing'
  | 'no-meta'
  | 'missing-scope'
  | 'quiet'
  | 'fresh';

/** The decision for one field. */
export type FieldPlan =
  | { action: 'generate'; reason: GenerateReason }
  | { action: 'skip'; reason: SkipReason };

/** What the decision depends on. */
export interface FieldInput {
  /** Which field. */
  field: MetaField;
  /** Its update switch. */
  enabled: boolean;
  /** The configured home directory, if any. */
  homeDir?: string;
  /** Whether the home directory exists. */
  homeDirExists: boolean;
  /** Its meta, if seeded. */
  meta?: ChannelMetaEntity;
  /** Whether the token can write this channel's purpose and topic (true
   * when its scopes are unknown: try, and report a refusal). */
  canWrite: boolean;
  /** The current value. */
  current: string;
  /** What the job last generated. */
  previous?: FieldState;
  /** Newest human message ts in the activity window. */
  lastHumanTs?: string;
}

const skip = (reason: SkipReason): FieldPlan => ({ action: 'skip', reason });
const generate = (reason: GenerateReason): FieldPlan => ({
  action: 'generate',
  reason,
});

/** `a` is set and later than `b` (ISO instants, or Slack ts with `cmp`;
 * an unparseable instant is never later). */
const newer = (
  a: string | undefined,
  b: string | undefined,
  cmp: (x: string, y: string) => number = (x, y) =>
    Date.parse(x) - Date.parse(y),
): boolean => a !== undefined && (b === undefined || cmp(a, b) > 0);

/** Why the field needs text, or `undefined` when it is fresh. */
const needOf = (
  input: FieldInput & { meta: ChannelMetaEntity },
): GenerateReason | undefined => {
  if (!input.current.trim()) return 'empty';
  const prev = input.previous;
  if (prev === undefined) return 'new';
  const metaNewer = newer(input.meta.generatedAt, prev.generatedAt);
  const postedSince =
    input.field === 'topic' &&
    newer(input.lastHumanTs, prev.lastMessageTs, compareTs);
  return metaNewer || postedSince ? 'stale' : undefined;
};

/**
 * Plan one field.
 *
 * @param input - The field's inputs.
 * @returns The decision.
 */
export function planField(input: FieldInput): FieldPlan {
  if (!input.enabled) return skip('disabled');
  if (input.homeDir === undefined) return skip('no-home-dir');
  if (!input.homeDirExists) return skip('home-dir-missing');
  const { meta } = input;
  if (meta === undefined) return skip('no-meta');
  if (input.field === 'topic' && input.lastHumanTs === undefined)
    return skip('quiet');
  const reason = needOf({ ...input, meta });
  if (reason === undefined) return skip('fresh');
  return input.canWrite ? generate(reason) : skip('missing-scope');
}
