/**
 * @module config/transcripts-schema
 *
 * Zod schema for the top-level `transcripts` block (spec 2.10, #54):
 * where `transcripts-fetch-video` files transcripts, where it caches raw
 * API responses, and the User-Agent it sends. Every field is optional;
 * `transcriptsConfig()` (`config/transcripts.ts`) resolves the defaults.
 * An invalid value fails `config check` and every run (Decision 76).
 */

import { z } from 'zod';

import { absolutePathSchema } from './absolute-path.js';

/** The `transcripts` block. */
export const transcriptsSchema = z.object({
  /** Where transcripts are filed (default `<default silo>/library/video-transcripts`). */
  libraryDir: absolutePathSchema('libraryDir').optional(),
  /** Raw API response cache (default `{stateDir}/transcripts`). */
  scratchDir: absolutePathSchema('scratchDir').optional(),
  /** User-Agent sent to the transcript API (default `jeeves-scripts/<instance.name>`). */
  userAgent: z.string().trim().min(1).optional(),
});

/** The `transcripts` block as configured (defaults unresolved). */
export type TranscriptsBlock = z.infer<typeof transcriptsSchema>;
