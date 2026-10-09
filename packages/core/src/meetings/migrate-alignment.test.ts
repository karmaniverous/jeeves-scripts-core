import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeSortTimestamp } from './lib/meeting-schema.js';

/**
 * Dry-run guard test (gap 2): verify that the materializeArtifacts
 * pattern does NOT write files when in dry-run mode.
 *
 * Tests the core logic extracted from migrate-alignment.ts to validate
 * the fix without requiring full runner infrastructure.
 */

/** Replicate the fixed dry-run prediction logic from migrate-alignment.ts. */
function predictArtifacts(meetingDir: string, source: string): string[] {
  const wouldCopy: string[] = [];
  if (source === 'gemini') {
    const geminiNotes = path.join(meetingDir, 'gemini-notes.txt');
    const summary = path.join(meetingDir, 'summary.txt');
    if (fs.existsSync(geminiNotes) && !fs.existsSync(summary)) {
      wouldCopy.push('summary.txt');
    }
  }
  return wouldCopy;
}

/**
 * Replicate the full sortTimestampMs precedence harvesting from
 * migrate-alignment.ts so we can unit-test it without runner infra.
 */
function harvestSortTimestamp(
  existing: Record<string, unknown>,
  meetingId: string,
) {
  const meetingTimestampMs =
    typeof existing.meetingTimestampMs === 'number'
      ? existing.meetingTimestampMs
      : typeof existing.sortTimestampMs === 'number' &&
          existing.sortSource === 'meeting-timestamp'
        ? existing.sortTimestampMs
        : null;
  const emailInternalDateMs =
    typeof existing.internalDateMs === 'number'
      ? existing.internalDateMs
      : null;
  const filenameDateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(meetingId);
  const filenameDateStr = filenameDateMatch ? filenameDateMatch[1] : null;
  const createdAt =
    typeof existing.createdAt === 'string' ? existing.createdAt : null;
  return computeSortTimestamp({
    meetingTimestampMs,
    emailInternalDateMs,
    filenameDateStr,
    packageCreatedAt: createdAt,
  });
}

describe('migrate-alignment dry-run guard (gap 2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-dryrun-'));
    fs.writeFileSync(
      path.join(tmpDir, 'gemini-notes.txt'),
      'Gemini transcript content',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dry-run predicts gemini summary.txt without creating it', () => {
    const wouldCopy = predictArtifacts(tmpDir, 'gemini');

    // Prediction is correct
    expect(wouldCopy).toContain('summary.txt');
    // Crucially: summary.txt must NOT exist on disk (no side effects)
    expect(fs.existsSync(path.join(tmpDir, 'summary.txt'))).toBe(false);
  });

  it('dry-run predicts nothing for non-gemini source', () => {
    const wouldCopy = predictArtifacts(tmpDir, 'fathom');
    expect(wouldCopy).toHaveLength(0);
  });

  it('dry-run predicts nothing when summary.txt already exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'summary.txt'), 'existing summary');
    const wouldCopy = predictArtifacts(tmpDir, 'gemini');
    expect(wouldCopy).toHaveLength(0);
  });
});

describe('migrate-alignment sortTimestampMs precedence', () => {
  it('harvests meetingTimestampMs from existing metadata', () => {
    const result = harvestSortTimestamp(
      { meetingTimestampMs: 1000, internalDateMs: 2000 },
      'some-meeting',
    );
    expect(result).toEqual({
      sortTimestampMs: 1000,
      sortSource: 'meeting-timestamp',
    });
  });

  it('recovers meeting-timestamp from prior sortTimestampMs', () => {
    const result = harvestSortTimestamp(
      { sortTimestampMs: 3000, sortSource: 'meeting-timestamp' },
      'some-meeting',
    );
    expect(result).toEqual({
      sortTimestampMs: 3000,
      sortSource: 'meeting-timestamp',
    });
  });

  it('does not recover sortTimestampMs when sortSource is not meeting-timestamp', () => {
    const result = harvestSortTimestamp(
      { sortTimestampMs: 3000, sortSource: 'email-internalDateMs' },
      'some-meeting',
    );
    // Should fall through to fallback since no other sources
    expect(result.sortSource).toBe('fallback');
  });

  it('extracts date from directory name as filename-date', () => {
    const result = harvestSortTimestamp({}, '2026-03-15-team-standup');
    expect(result.sortSource).toBe('filename-date');
    expect(result.sortTimestampMs).toBe(new Date('2026-03-15').getTime());
  });

  it('falls back to packageCreatedAt when no other sources', () => {
    const result = harvestSortTimestamp(
      { createdAt: '2026-01-01T12:00:00Z' },
      'abc123hash',
    );
    expect(result.sortSource).toBe('package-createdAt');
  });

  it('emailInternalDateMs wins over filename-date', () => {
    const result = harvestSortTimestamp(
      { internalDateMs: 5000 },
      '2026-03-15-meeting',
    );
    expect(result).toEqual({
      sortTimestampMs: 5000,
      sortSource: 'email-internalDateMs',
    });
  });
});
