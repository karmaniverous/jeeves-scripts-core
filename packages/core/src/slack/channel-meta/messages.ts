/**
 * @module slack/channel-meta/messages
 *
 * The message fields the job reads, from core's Slack archive
 * (`{silo}/slack/<name> (<id>)/<ts>.json`) or from
 * `conversations.history`, and how it tells people from bots. Pure.
 */

import { z } from 'zod';

/** One message, archive or API shape (only what the job reads). */
export const messageSchema = z
  .object({
    ts: z.string().regex(/^\d+\.\d+$/),
    user: z.string().optional(),
    text: z.string().optional(),
    subtype: z.string().optional(),
    /** Archive: the poster's bot id. */
    botId: z.string().optional(),
    /** API: the poster's bot id. */
    bot_id: z.string().optional(),
    /** Archive: the author, a configured person's name or the user
     * cache's entry. */
    userName: z
      .union([
        z.string(),
        z
          .object({
            alias: z.string().optional(),
            name: z.string().optional(),
            is_bot: z.boolean().optional(),
          })
          .loose(),
      ])
      .optional(),
  })
  .loose();

/** A message. */
export type ChannelMessage = z.infer<typeof messageSchema>;

/** Subtypes a person posts; every other subtype is Slack or a bot. */
const HUMAN_SUBTYPES = new Set([
  'thread_broadcast',
  'file_share',
  'me_message',
]);

/**
 * Whether a person posted the message: it has an author, no bot marker,
 * and no subtype except the ones people post.
 *
 * @param m - The message.
 * @returns `true` for a person's post.
 */
export const isHumanMessage = (m: ChannelMessage): boolean =>
  m.user !== undefined &&
  m.botId === undefined &&
  m.bot_id === undefined &&
  (typeof m.userName !== 'object' || m.userName.is_bot !== true) &&
  (m.subtype === undefined || HUMAN_SUBTYPES.has(m.subtype));

/**
 * Compare two Slack timestamps (`<seconds>.<micros>`) numerically.
 *
 * @param a - One ts.
 * @param b - The other.
 * @returns Negative, zero or positive.
 */
export function compareTs(a: string, b: string): number {
  const [as = '0', af = ''] = a.split('.');
  const [bs = '0', bf = ''] = b.split('.');
  const secs = Number(as) - Number(bs);
  if (secs !== 0) return secs;
  return Number(af.padEnd(6, '0')) - Number(bf.padEnd(6, '0'));
}

/** The later of two timestamps (`undefined` counts as earliest). */
export const laterTs = (
  a: string | undefined,
  b: string | undefined,
): string | undefined =>
  a === undefined ? b : b === undefined || compareTs(a, b) >= 0 ? a : b;

/** The Slack ts for an instant (`<seconds>.000000`). */
export const tsAt = (ms: number): string =>
  `${String(Math.floor(ms / 1000))}.000000`;

/** The author's display name, or their id. */
export const authorOf = (m: ChannelMessage): string =>
  typeof m.userName === 'string'
    ? m.userName
    : (m.userName?.alias ?? m.userName?.name ?? m.user ?? 'unknown');
