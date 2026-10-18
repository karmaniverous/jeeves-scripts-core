/**
 * @module schemas
 *
 * Zod 4 schemas for the external JSON email-respond reads: `gog` CLI
 * output (search pages, message metadata, threads, label lists). Parsing
 * through these turns malformed output into a clear error at the
 * boundary instead of an incidental TypeError deeper in.
 *
 * Gmail payloads are recursive and only partly used, so payload parts
 * are validated loosely (known fields typed, unknown fields kept) and
 * handed to the shared body extractor.
 */

import { z } from 'zod';

import type { GmailPayloadPart } from '../../../lib/email.js';

/**
 * One Gmail header. gog omits `value` when a header is empty (e.g.
 * GitHub's `X-GitHub-Labels`), so a missing value reads as ''.
 */
export const GmailHeaderSchema = z.object({
  name: z.string(),
  value: z.string().default(''),
});

/** A Gmail payload part (recursive; unknown fields kept). */
export const GmailPayloadPartSchema: z.ZodType<GmailPayloadPart> = z.lazy(() =>
  z.looseObject({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    body: z
      .looseObject({
        data: z.string().optional(),
        size: z.number().optional(),
        attachmentId: z.string().optional(),
      })
      .optional(),
    parts: z.array(GmailPayloadPartSchema).optional(),
  }),
);

/** A top-level message payload: a part plus its headers. */
const MessagePayloadSchema = z.intersection(
  GmailPayloadPartSchema,
  z.looseObject({ headers: z.array(GmailHeaderSchema).optional() }),
);

/** One message as `gog gmail get` / `thread get` return it. */
const GmailMessageSchema = z.looseObject({
  id: z.string().optional(),
  threadId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: MessagePayloadSchema.optional(),
});

/** `gog gmail get --json`. */
export const MessageGetResponseSchema = z.looseObject({
  message: GmailMessageSchema.optional(),
});

/** `gog gmail thread get --json`. */
export const ThreadGetResponseSchema = z.looseObject({
  thread: z
    .looseObject({ messages: z.array(GmailMessageSchema).optional() })
    .optional(),
});

/** `gog gmail labels list --json`. */
export const LabelsListResponseSchema = z.looseObject({
  labels: z.array(z.looseObject({ name: z.string() })).optional(),
});

/**
 * Parse `raw` JSON with `schema`, naming `what` in the error.
 *
 * @throws Error when the text is not JSON or doesn't match the schema.
 */
export function parseJsonWith<T>(
  schema: z.ZodType<T>,
  raw: string,
  what: string,
): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${what}: output is not JSON`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `${what}: unexpected shape: ${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
