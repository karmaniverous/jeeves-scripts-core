/**
 * @module config/slack-schema
 *
 * The `slack` config block: what this instance decides about Slack
 * channels (Decision 9). Everything Slack itself knows about a channel or
 * user (name, type, privacy, members, emails) is read from Slack and
 * cached in the state folder, never configured here.
 */

import { z } from 'zod';

import { isAbsolutePath } from './absolute-path.js';

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

/** `slack.backfillBudgetSeconds` when unset. */
const SLACK_BACKFILL_BUDGET_SECONDS = 60;

/** The `slack` block. */
export const slackConfigSchema = z.object({
  /** Per-channel decisions, keyed by channel id. */
  channels: z
    .record(slackChannelIdSchema, slackChannelConfigSchema)
    .default({}),
  /**
   * `slack-poll`: the most time one channel may take in a run. A channel
   * with a larger backlog saves its read position and resumes next run, so
   * it can't starve the channels after it. Keep it well under the job's
   * timeout.
   */
  backfillBudgetSeconds: z
    .number()
    .int()
    .positive()
    .default(SLACK_BACKFILL_BUDGET_SECONDS),
  /**
   * `slack-poll`: how far back to read a channel with no read position yet
   * (newly joined or discovered). `0` starts from now; unset reads its
   * full history.
   */
  newChannelLookbackDays: z.number().nonnegative().optional(),
});

/** The `slack` block. */
export type SlackConfig = z.infer<typeof slackConfigSchema>;
