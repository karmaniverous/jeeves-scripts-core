/**
 * @module config/pipeline-email-schema
 *
 * Zod schema for the `pipeline.emailConfig` block: email pipeline flags,
 * digest, historical backfill, and meeting-email actions.
 *
 * Ported from `jeeves-scripts-template` `src/lib/pipeline-config-email.ts`
 * (template `main` at `322054c`); same keys (Decision 3, Decision 19).
 */

import { z } from 'zod';

/** Email digest settings (`emailConfig.digest`). */
export const digestConfigSchema = z.object({
  /** Slack channel the email digest posts to. */
  slackChannelId: z.string(),
});

/**
 * Paced historical Gmail backfill. Optional: absent means the backfill
 * job has nothing configured and fails if run without CLI args. No
 * defaults.
 */
export const backfillConfigSchema = z.object({
  /** Gmail accounts to backfill. */
  accounts: z.array(z.string().min(1)).min(1),
  /** How far back from now to walk, in days. */
  lookbackDays: z.number().int().positive(),
  /** Days searched per run, per account. */
  windowDays: z.number().int().positive(),
});

/**
 * Gmail actions meetings/extract take on a meeting's source email.
 * Optional: absent keeps the original behaviour (archive inbox meeting
 * emails).
 */
export const meetingsEmailConfigSchema = z.object({
  /** Archive the source email out of INBOX after packaging. */
  archive: z.boolean(),
});

/** The `pipeline.emailConfig` block. */
export const emailConfigSchema = z.object({
  /** Report Gmail changes (labels, archive) without making them. */
  reportOnly: z.boolean(),
  /** Email digest. */
  digest: digestConfigSchema,
  /** Paced historical backfill. */
  backfill: backfillConfigSchema.optional(),
  /** Actions on meeting source emails. */
  meetings: meetingsEmailConfigSchema.optional(),
});

/** Parsed `pipeline.emailConfig` block. */
export type EmailConfig = z.infer<typeof emailConfigSchema>;
/** Parsed `pipeline.emailConfig.backfill` block. */
export type BackfillConfig = z.infer<typeof backfillConfigSchema>;
/** Parsed `pipeline.emailConfig.meetings` block. */
export type MeetingsEmailConfig = z.infer<typeof meetingsEmailConfigSchema>;
