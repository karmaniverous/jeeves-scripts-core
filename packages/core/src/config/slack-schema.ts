/**
 * @module config/slack-schema
 *
 * The `slack` config block: what this instance decides about Slack
 * channels (Decision 9), plus the optional `slack.channelMeta` block of
 * `slack-refresh-channel-meta` (spec 2.6, #49). Everything Slack itself
 * knows about a channel or user (name, type, privacy, members, emails) is
 * read from Slack and cached in the state folder, never configured here.
 * A present `channelMeta` block missing a required key, or one whose
 * report has no directory (`config/slack-channel-meta-schema`
 * `reportDirIssue`, checked on the whole config by `config/schema`, so
 * this schema has no refinement and `.pick()`/`.omit()` work on it), fails `config check` and every run
 * (Decision 76); with no block the runnable skips.
 */

import { z } from 'zod';

import { isAbsolutePath } from './absolute-path.js';
import { slackChannelIdSchema } from './slack-channel-id.js';
import { slackChannelMetaSchema } from './slack-channel-meta-schema.js';

export {
  type SlackChannelMetaBlock,
  slackChannelMetaSchema,
} from './slack-channel-meta-schema.js';

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

export { slackChannelIdSchema } from './slack-channel-id.js';

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
  /** `slack-refresh-channel-meta` (spec 2.6); absent: it skips. */
  channelMeta: slackChannelMetaSchema.optional(),
});

/** The `slack` block. */
export type SlackConfig = z.infer<typeof slackConfigSchema>;
