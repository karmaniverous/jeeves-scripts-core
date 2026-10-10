/**
 * @module config/slack-schema
 *
 * The `slack` config block: what this instance decides about Slack
 * channels (Decision 9). Everything Slack itself knows about a channel or
 * user (name, type, privacy, members, emails) is read from Slack and
 * cached in the state folder, never configured here.
 */

import path from 'node:path';

import { z } from 'zod';

/** An absolute path on Windows (`D:/x`, `D:\x`, `\\host\share`) or POSIX (`/x`). */
const isAbsolutePath = (p: string): boolean =>
  path.win32.isAbsolute(p) || path.posix.isAbsolute(p);

/** What we decide about one channel. */
export const slackChannelConfigSchema = z.strictObject({
  /** Project the channel belongs to; tags its indexed messages. */
  project: z.string().min(1).optional(),
  /**
   * The channel's home directory: where the assistant reads and writes the
   * files a conversation in this channel is about. Absolute path.
   */
  homeDir: z
    .string()
    .min(1)
    .refine(isAbsolutePath, { message: 'homeDir must be an absolute path' })
    .optional(),
});

/** What we decide about one channel. */
export type SlackChannelConfig = z.infer<typeof slackChannelConfigSchema>;

/** A Slack channel id (`C…`, `G…` or `D…`). */
export const slackChannelIdSchema = z
  .string()
  .regex(/^[CDG][A-Z0-9]+$/, 'expected a Slack channel id like C0123456789');

/** The `slack` block. */
export const slackConfigSchema = z.object({
  /** Per-channel decisions, keyed by channel id. */
  channels: z
    .record(slackChannelIdSchema, slackChannelConfigSchema)
    .default({}),
});

/** The `slack` block. */
export type SlackConfig = z.infer<typeof slackConfigSchema>;
