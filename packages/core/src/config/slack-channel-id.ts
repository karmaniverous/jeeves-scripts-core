/**
 * @module config/slack-channel-id
 *
 * A Slack channel id, shared by the `slack` block and its
 * `channelMeta` block.
 */

import { z } from 'zod';

/** A Slack channel id (`C…`, `G…` or `D…`). */
export const slackChannelIdSchema = z
  .string()
  .regex(/^[CDG][A-Z0-9]+$/, 'expected a Slack channel id like C0123456789');
