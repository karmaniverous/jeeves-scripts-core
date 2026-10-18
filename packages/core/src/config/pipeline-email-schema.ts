/**
 * @module config/pipeline-email-schema
 *
 * Zod schema for the `pipeline.emailConfig` block: email pipeline flags,
 * digest, historical backfill, meeting-email actions, and the
 * assistant-mailbox auto-reply (`respond`).
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

/** An email address: trimmed, lowercased, loosely shaped like `a@b.c`. */
const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email address');

/**
 * Assistant-mailbox auto-reply (`email-respond`). Optional: absent means
 * the job logs a skip line and exits 0. `mailbox` must be a `gmail`
 * account in `pipeline.accounts` (checked by the pipeline schema): replies
 * go out through gog. `allowedSenders` is deliberately independent of
 * `accounts`: being allowed to trigger a reply is a narrower,
 * explicitly-configured permission, not a side effect of email ingestion.
 */
export const respondConfigSchema = z
  .object({
    /** The mailbox that receives and replies to mail. */
    mailbox: emailAddressSchema,
    /** Senders allowed to trigger a reply. Must not include `mailbox`. */
    allowedSenders: z.array(emailAddressSchema).min(1),
    /** Per-thread reply rate limit (default 3/hour). */
    maxRepliesPerThreadPerHour: z.number().int().min(1).default(3),
    /** Messages processed per run, oldest first (default 3). */
    maxPerRun: z.number().int().min(1).default(3),
    /** Gmail label applied to a thread after a successful reply. */
    label: z.string().trim().min(1).default('assistant-replied'),
    /** Discovery + qualification only: no dispatch, no send, no state writes. */
    dryRun: z.boolean().optional(),
    /**
     * Mirror each sent reply to Slack (the sender's DM, or a channel the
     * email asked for). Needs the `users:read.email` bot scope. Default off.
     */
    slackMirror: z.boolean().default(false),
  })
  .strict()
  .refine((data) => !data.allowedSenders.includes(data.mailbox), {
    message:
      'emailConfig.respond.allowedSenders must not include the mailbox address',
    path: ['allowedSenders'],
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
  /** Assistant-mailbox auto-reply (`email-respond`). */
  respond: respondConfigSchema.optional(),
});

/** Parsed `pipeline.emailConfig` block. */
export type EmailConfig = z.infer<typeof emailConfigSchema>;
/** Parsed `pipeline.emailConfig.backfill` block. */
export type BackfillConfig = z.infer<typeof backfillConfigSchema>;
/** Parsed `pipeline.emailConfig.meetings` block. */
export type MeetingsEmailConfig = z.infer<typeof meetingsEmailConfigSchema>;
/** Parsed `pipeline.emailConfig.respond` block. */
export type RespondConfig = z.infer<typeof respondConfigSchema>;
