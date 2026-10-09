/**
 * @module config/pipeline-schema
 *
 * Zod schema for the `pipeline` block of `jeeves-scripts.json`: email
 * accounts, domain routing, feature flags, named refs, and the raw
 * Google Drive sync block. Same keys as today's `pipeline-config.json`
 * (Decision 3, Decision 19).
 *
 * Ported from `jeeves-scripts-template` `src/lib/pipeline-config.ts`
 * (template `main` at `322054c`); accessors moved to
 * `config/pipeline-accessors.ts`.
 */

import { z } from 'zod';

import { isSafeSecretRef, UNSAFE_SECRET_REF_MESSAGE } from './imap-secrets.js';
import { emailConfigSchema } from './pipeline-email-schema.js';

export type { BackfillConfig, EmailConfig } from './pipeline-email-schema.js';

/**
 * `imap.password`: `{ secretRef }` naming a file in the IMAP secrets
 * directory. A literal password is rejected (Decision 19: the config file
 * never holds a secret value); the template's deprecated literal form is
 * not carried into core.
 */
export const imapPasswordSchema = z.strictObject({
  secretRef: z.string().refine(isSafeSecretRef, UNSAFE_SECRET_REF_MESSAGE),
});

export const imapConnectionSchema = z.object({
  host: z.string(),
  port: z.number(),
  tls: z.boolean(),
  user: z.string(),
  password: imapPasswordSchema,
});

export const calendarConfigSchema = z.union([
  z.object({ tokenFile: z.string() }),
  z.object({ serviceAccount: z.literal('auto') }),
]);

export const accountSchema = z
  .object({
    email: z.string(),
    type: z.enum(['gmail', 'imap']),
    calendar: calendarConfigSchema.optional(),
    emailPolling: z.boolean(),
    imap: imapConnectionSchema.optional(),
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

export const domainEntrySchema = z.object({
  pattern: z.string(),
  bucket: z.string(),
});

export const bucketsSchema = z.object({
  domains: z.array(domainEntrySchema),
  priority: z.array(z.string()),
});

export const pipelineSchema = z.object({
  accounts: z.array(accountSchema),
  buckets: bucketsSchema,
  refs: z.record(z.string(), z.string()),
  emailConfig: emailConfigSchema,
  /**
   * Google Drive sync block, kept raw here: the google-drive domain
   * validates it, so a mistake in it fails only the Drive job, never
   * every job that loads this config.
   */
  googleDrive: z.unknown().optional(),
});

export type PipelineConfig = z.infer<typeof pipelineSchema>;
export type AccountConfig = z.infer<typeof accountSchema>;
export type ImapConnection = z.infer<typeof imapConnectionSchema>;
export type BucketsConfig = z.infer<typeof bucketsSchema>;
