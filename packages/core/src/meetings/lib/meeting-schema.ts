/**
 * @module meeting-schema
 *
 * Canonical meeting package contract — Zod schema for meeting.json
 * and the writeMeetingMeta helper that enforces required fields.
 *
 * Every meeting package must have a meeting.json conforming to this
 * schema. The writeMeetingMeta helper is the single write path for
 * meeting metadata across all modalities.
 */

import fs from 'node:fs';
import path from 'node:path';

import { writeJsonAtomic } from '@karmaniverous/jeeves';
import { z } from 'zod';

// ── Sort-source values ──────────────────────────────────────────────

export const SORT_SOURCES = [
  'meeting-timestamp',
  'email-internalDateMs',
  'filename-date',
  'package-createdAt',
  'fallback',
] as const;

export type SortSource = (typeof SORT_SOURCES)[number];

// ── Fathom-specific enums ───────────────────────────────────────────

export const FATHOM_KINDS = ['share', 'call'] as const;
export type FathomKind = (typeof FATHOM_KINDS)[number];

export const FATHOM_TRANSCRIPT_SOURCES = [
  'share-page',
  'email-summary',
] as const;
export type FathomTranscriptSource = (typeof FATHOM_TRANSCRIPT_SOURCES)[number];

// ── Schema ──────────────────────────────────────────────────────────

/** Common required fields per spec section 1.1. */
const meetingMetaRequiredSchema = z.object({
  meetingId: z.string().min(1),
  source: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sortTimestampMs: z.number().nullable(),
  sortSource: z.string().min(1),
  hasTranscript: z.boolean(),
});

/** Full meeting.json — required fields plus optional/legacy fields. */
export const meetingMetaSchema = meetingMetaRequiredSchema.extend({
  title: z.string().nullable().optional(),
  normalizedTitle: z.string().optional(),
  participants: z.array(z.string()).optional(),
  /** Listed people among the participants (`people` config): id and name. */
  people: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  sources: z.array(z.record(z.string(), z.unknown())).optional(),
  artifacts: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().nullable().optional(),

  // Fathom-specific (section 7.2)
  fathomKind: z.enum(FATHOM_KINDS).optional(),
  fathomUrl: z.string().optional(),
  fathomFetchedAt: z.string().nullable().optional(),
  fathomTranscriptSource: z
    .enum(FATHOM_TRANSCRIPT_SOURCES)
    .nullable()
    .optional(),
});

export type MeetingMeta = z.infer<typeof meetingMetaSchema>;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Compute sortTimestampMs using the precedence rule (spec section 3.3).
 *
 * Returns `{ sortTimestampMs, sortSource }`.
 */
export function computeSortTimestamp(opts: {
  meetingTimestampMs?: number | null;
  emailInternalDateMs?: number | null;
  filenameDateStr?: string | null;
  packageCreatedAt?: string | null;
}): { sortTimestampMs: number | null; sortSource: SortSource } {
  if (
    opts.meetingTimestampMs != null &&
    Number.isFinite(opts.meetingTimestampMs)
  ) {
    return {
      sortTimestampMs: opts.meetingTimestampMs,
      sortSource: 'meeting-timestamp',
    };
  }

  if (
    opts.emailInternalDateMs != null &&
    Number.isFinite(opts.emailInternalDateMs)
  ) {
    return {
      sortTimestampMs: opts.emailInternalDateMs,
      sortSource: 'email-internalDateMs',
    };
  }

  if (opts.filenameDateStr) {
    const d = new Date(opts.filenameDateStr);
    if (!isNaN(d.getTime())) {
      return { sortTimestampMs: d.getTime(), sortSource: 'filename-date' };
    }
  }

  if (opts.packageCreatedAt) {
    const d = new Date(opts.packageCreatedAt);
    if (!isNaN(d.getTime())) {
      return { sortTimestampMs: d.getTime(), sortSource: 'package-createdAt' };
    }
  }

  return { sortTimestampMs: null, sortSource: 'fallback' };
}

/**
 * Check whether transcript.txt exists in a meeting directory.
 */
export function checkHasTranscript(meetingDir: string): boolean {
  return fs.existsSync(path.join(meetingDir, 'transcript.txt'));
}

/**
 * Write meeting.json — the single canonical write path for meeting metadata.
 *
 * Merges `updates` into existing metadata (if any), validates the required
 * fields, and writes atomically. Returns the final validated metadata.
 *
 * Throws if the result would violate the required-fields contract.
 */
export function writeMeetingMeta(
  meetingDir: string,
  updates: Record<string, unknown>,
): MeetingMeta {
  const metaPath = path.join(meetingDir, 'meeting.json');

  // Read existing
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    // No existing file or invalid JSON — start fresh
  }

  // Merge: updates override existing
  const merged = { ...existing, ...updates };

  // Set updatedAt
  merged.updatedAt = new Date().toISOString();

  // Validate required fields
  const validation = meetingMetaSchema.safeParse(merged);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(
      `writeMeetingMeta: invalid meeting metadata for ${meetingDir}: ${issues}`,
    );
  }

  writeJsonAtomic(metaPath, merged);

  return validation.data;
}
