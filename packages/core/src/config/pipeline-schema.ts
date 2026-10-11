/**
 * @module config/pipeline-schema
 *
 * Zod schema for the `pipeline` block of `jeeves-scripts.json`: email
 * accounts, domain routing, feature flags, named refs, and the raw
 * Google Drive sync block. Same keys as the template's `pipeline-config.json`
 * (Decision 3, Decision 19).
 *
 * Ported from `jeeves-scripts-template` `src/lib/pipeline-config.ts`
 * (template `main` at `322054c`); accessors moved to
 * `config/pipeline-accessors.ts`.
 */

import { z } from 'zod';

import { emailConfigSchema } from './pipeline-email-schema.js';
import { isSafeSecretRef, UNSAFE_SECRET_REF_MESSAGE } from './secret-ref.js';

export type { BackfillConfig, EmailConfig } from './pipeline-email-schema.js';

/**
 * `imap.password`: `{ secretRef }` naming a file in the IMAP secrets
 * directory. A literal password is rejected (Decision 19: the config file
 * never holds a secret value); the template's deprecated literal form is
 * not carried into core.
 */
export const imapPasswordSchema = z.strictObject({
  /** Name of the file in the IMAP secrets directory holding the password. */
  secretRef: z.string().refine(isSafeSecretRef, UNSAFE_SECRET_REF_MESSAGE),
});

/** IMAP connection for an `imap` account. */
export const imapConnectionSchema = z.object({
  /** IMAP server host. */
  host: z.string(),
  /** IMAP server port. */
  port: z.number(),
  /** Connect over TLS. */
  tls: z.boolean(),
  /** Login user. */
  user: z.string(),
  /** Password, by secret reference only. */
  password: imapPasswordSchema,
});

/** Calendar access for an account: an OAuth token file, or the gog service account. */
export const calendarConfigSchema = z.union([
  z.object({
    /** OAuth token file name. */
    tokenFile: z.string(),
  }),
  z.object({
    /** Use the gog service account for this account's domain. */
    serviceAccount: z.literal('auto'),
  }),
]);

/** One mail and calendar account (`pipeline.accounts[]`). */
export const accountSchema = z
  .object({
    /** Account email address. */
    email: z.string(),
    /** Access method. */
    type: z.enum(['gmail', 'imap']),
    /** Calendar access; absent means no calendar polling. */
    calendar: calendarConfigSchema.optional(),
    /** Poll this account's mail. */
    emailPolling: z.boolean(),
    /** IMAP connection; required when `type` is `imap`. */
    imap: imapConnectionSchema.optional(),
    /** IMAP folders to poll. */
    folders: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'imap' && !data.imap) {
      ctx.addIssue({
        code: 'custom',
        message: 'IMAP accounts require an imap connection block',
        path: ['imap'],
      });
    }
  });

/** One sender-domain routing rule. */
export const domainEntrySchema = z.object({
  /** Sender domain pattern. */
  pattern: z.string(),
  /** Bucket mail from matching senders goes to. */
  bucket: z.string(),
});

/** Mail bucket routing (`pipeline.buckets`). */
export const bucketsSchema = z.object({
  /** Domain rules, first match wins. */
  domains: z.array(domainEntrySchema),
  /** Bucket names, highest priority first. */
  priority: z.array(z.string()),
});

/** The `pipeline` block: the template's `pipeline-config.json`, same keys. */
export const pipelineSchema = z.object({
  /** Mail and calendar accounts. */
  accounts: z.array(accountSchema),
  /** Mail bucket routing. */
  buckets: bucketsSchema,
  /** Named references (Slack channels, Notion ids, paths) by dotted key. */
  refs: z.record(z.string(), z.string()),
  /** Email pipeline settings. */
  emailConfig: emailConfigSchema,
  /**
   * Google Drive sync block, kept raw here: the google-drive domain
   * validates it, so a mistake in it fails only the Drive job, never
   * every job that loads this config.
   */
  googleDrive: z.unknown().optional(),
});

/** Parsed `pipeline` block. */
export type PipelineConfig = z.infer<typeof pipelineSchema>;
/** Parsed `pipeline.accounts[]` entry. */
export type AccountConfig = z.infer<typeof accountSchema>;
/** Parsed IMAP connection. */
export type ImapConnection = z.infer<typeof imapConnectionSchema>;
/** Parsed `pipeline.buckets` block. */
export type BucketsConfig = z.infer<typeof bucketsSchema>;
