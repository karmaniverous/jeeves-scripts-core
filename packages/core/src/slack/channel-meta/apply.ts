/**
 * @module slack/channel-meta/apply
 *
 * Set one channel's description (`conversations.setPurpose`) or topic
 * (`conversations.setTopic`) with its own workspace's bot, then re-read
 * it (`conversations.info`) to verify. A Slack refusal (`missing_scope`,
 * `not_in_channel`, `channel_not_found`, …) is returned as a failure with
 * Slack's code, never thrown, so one channel can't stop the run; any
 * other error as an unexpected one, its message in the job's stderr log
 * (`channel-meta/report-safe`).
 */

import { z } from 'zod';

import { type SlackClient } from '../../lib/slack-client.js';
import type { MetaField } from './plan.js';
import { reportSafeCode } from './report-safe.js';
import { normalizeSlackText } from './state.js';

/** The outcome of one set. */
export type ApplyOutcome =
  | {
      ok: true;
      /** The value Slack holds after the set. */
      value: string;
      /** Whether it equals what was sent (after Slack's escaping). */
      verified: boolean;
    }
  | {
      ok: false;
      /** Slack's error code, or `channel-meta/report-safe`'s unexpected error. */
      code: string;
    };

const infoSchema = z
  .object({
    channel: z
      .object({
        purpose: z.object({ value: z.string() }).loose().optional(),
        topic: z.object({ value: z.string() }).loose().optional(),
      })
      .loose(),
  })
  .loose();

const SETTERS: Record<
  MetaField,
  { method: string; param: string; key: 'purpose' | 'topic' }
> = {
  description: {
    method: 'conversations.setPurpose',
    param: 'purpose',
    key: 'purpose',
  },
  topic: { method: 'conversations.setTopic', param: 'topic', key: 'topic' },
};

/**
 * Set a field and verify it.
 *
 * @param client - The channel's workspace client.
 * @param channel - Channel id.
 * @param field - Which field.
 * @param text - The value.
 * @returns The outcome.
 */
export async function applyField(
  client: SlackClient,
  channel: string,
  field: MetaField,
  text: string,
): Promise<ApplyOutcome> {
  const { method, param, key } = SETTERS[field];
  try {
    await client.post(method, { channel, [param]: text });
    const info = infoSchema.parse(
      await client.call('conversations.info', { channel }),
    );
    const value = info.channel[key]?.value ?? '';
    return {
      ok: true,
      value,
      verified: normalizeSlackText(value) === normalizeSlackText(text),
    };
  } catch (e) {
    return {
      ok: false,
      code: reportSafeCode(e, `setting the ${field} of ${channel}`),
    };
  }
}
