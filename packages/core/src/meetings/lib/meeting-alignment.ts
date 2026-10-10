/**
 * @module meetings/lib/meeting-alignment
 *
 * Per-package rules for `meetings/migrate-alignment`: read a package's
 * `meeting.json`, test it against the canonical meeting schema, infer a
 * missing source and date from metadata and directory contents, and
 * materialize canonical artifacts from legacy ones (with a backup).
 */

import fs from 'node:fs';
import path from 'node:path';

import { meetingMetaSchema } from './meeting-schema.js';
import { backupFile } from './migration-backup.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** A package's `meeting.json`, or null when it is missing or not JSON. */
export function readMeetingJson(
  meetingDir: string,
): Record<string, unknown> | null {
  const metaPath = path.join(meetingDir, 'meeting.json');
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** Whether metadata already matches the canonical meeting schema. */
export function isConformant(meta: Record<string, unknown>): boolean {
  return meetingMetaSchema.safeParse(meta).success;
}

/** Infer source from existing metadata or directory contents. */
export function inferSource(
  meta: Record<string, unknown>,
  meetingDir: string,
): string {
  if (typeof meta.source === 'string' && meta.source) return meta.source;

  // Check sources array
  const sources = meta.sources as Record<string, unknown>[] | undefined;
  if (sources?.[0]) {
    const type = sources[0].type ?? sources[0].kind;
    if (typeof type === 'string' && type) return type;
  }

  // Heuristic from files
  try {
    const files = fs.readdirSync(meetingDir);
    if (files.some((f) => f.startsWith('fathom-') && f.endsWith('.html')))
      return 'fathom';
    if (files.includes('gemini_link.txt')) return 'gemini';
    if (files.includes('fathom_link.txt')) return 'fathom';
  } catch {
    // ignore
  }

  return 'unknown';
}

/** Infer date from existing metadata or directory name. */
export function inferDate(
  meta: Record<string, unknown>,
  meetingId: string,
): string {
  if (typeof meta.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.date))
    return meta.date;
  if (
    typeof meta.meetingDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(meta.meetingDate)
  )
    return meta.meetingDate;

  // Try parsing from createdAt
  if (typeof meta.createdAt === 'string') {
    const d = new Date(meta.createdAt);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Try parsing from ingestedAt
  if (typeof meta.ingestedAt === 'string') {
    const d = new Date(meta.ingestedAt);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Fallback: today
  meetingId;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Materialize canonical artifacts from legacy modality-specific
 * artifacts (spec section 3.2).
 */
export function materializeArtifacts(
  meetingDir: string,
  source: string,
  batchId: string,
): { copied: string[]; changes: Record<string, string> } {
  const copied: string[] = [];
  const changes: Record<string, string> = {};

  // gemini-notes.txt -> summary.txt (if summary.txt doesn't exist)
  if (source === 'gemini') {
    const geminiNotes = path.join(meetingDir, 'gemini-notes.txt');
    const summary = path.join(meetingDir, 'summary.txt');
    if (fs.existsSync(geminiNotes) && !fs.existsSync(summary)) {
      backupFile(meetingDir, 'summary.txt', batchId);
      fs.copyFileSync(geminiNotes, summary);
      copied.push('summary.txt');
      changes['summary.txt'] = 'materialized from gemini-notes.txt';
    }
  }

  return { copied, changes };
}
