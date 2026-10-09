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

/** Parse and validate an existing meeting.json, returning null on failure. */
export function parseMeetingMeta(raw: unknown): MeetingMeta | null {
  const result = meetingMetaSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Validate that an object satisfies the required minimum fields. */
export function validateRequiredFields(meta: Record<string, unknown>): {
  success: boolean;
  data?: z.infer<typeof meetingMetaRequiredSchema>;
  error?: z.ZodError;
} {
  return meetingMetaRequiredSchema.safeParse(meta);
}

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
 * Build computeSortTimestamp input from existing meeting metadata.
 *
 * Extracts the relevant fields from a raw metadata record and a meetingId,
 * applying the canonical precedence rules (spec section 3.3). Shared by
 * migration scripts that need to recompute sort timestamps.
 */
export function buildSortTimestampInput(
  meta: Record<string, unknown>,
  meetingId: string,
): Parameters<typeof computeSortTimestamp>[0] {
  // Fallback: older meetings predate meetingTimestampMs as a first-class field.
  // When sortSource === 'meeting-timestamp', sortTimestampMs IS the original
  // meeting timestamp, so it's safe to recover the value from there.
  const meetingTimestampMs =
    typeof meta.meetingTimestampMs === 'number'
      ? meta.meetingTimestampMs
      : typeof meta.sortTimestampMs === 'number' &&
          meta.sortSource === 'meeting-timestamp'
        ? meta.sortTimestampMs
        : null;
  const emailInternalDateMs =
    typeof meta.internalDateMs === 'number' ? meta.internalDateMs : null;
  const filenameDateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(meetingId);
  const filenameDateStr = filenameDateMatch ? filenameDateMatch[1] : null;
  const packageCreatedAt =
    typeof meta.createdAt === 'string' ? meta.createdAt : null;
  return {
    meetingTimestampMs,
    emailInternalDateMs,
    filenameDateStr,
    packageCreatedAt,
  };
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

  // Write atomically (write to temp, rename)
  const tmpPath = metaPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, metaPath);

  return validation.data;
}
