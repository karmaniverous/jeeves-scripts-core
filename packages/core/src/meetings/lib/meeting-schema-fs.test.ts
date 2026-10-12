import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkHasTranscript, writeMeetingMeta } from './meeting-schema.js';

describe('checkHasTranscript', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when transcript.txt exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'transcript.txt'), 'hello');
    expect(checkHasTranscript(tmpDir)).toBe(true);
  });

  it('returns false when transcript.txt does not exist', () => {
    expect(checkHasTranscript(tmpDir)).toBe(false);
  });
});

describe('writeMeetingMeta', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid meeting.json', () => {
    const meta = writeMeetingMeta(tmpDir, {
      meetingId: 'test123',
      source: 'gemini',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
    });

    expect(meta.meetingId).toBe('test123');
    expect(meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'meeting.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(written.meetingId).toBe('test123');
  });

  it('merges with existing metadata', () => {
    // Write initial
    fs.writeFileSync(
      path.join(tmpDir, 'meeting.json'),
      JSON.stringify({
        meetingId: 'test123',
        source: 'gemini',
        date: '2026-04-09',
        sortTimestampMs: null,
        sortSource: 'fallback',
        hasTranscript: false,
        title: 'Original Title',
      }),
    );

    // Update
    const meta = writeMeetingMeta(tmpDir, {
      hasTranscript: true,
    });

    expect(meta.meetingId).toBe('test123');
    expect(meta.hasTranscript).toBe(true);
    expect(meta.title).toBe('Original Title');
  });

  it('throws for invalid metadata', () => {
    expect(() => writeMeetingMeta(tmpDir, { meetingId: 'test' })).toThrow();
  });

  it('preserves extra fields not in schema', () => {
    const meta = writeMeetingMeta(tmpDir, {
      meetingId: 'test123',
      source: 'fathom',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
      transcriptExtractedAt: '2026-04-09T12:00:00Z',
    });

    // Schema strips unknown fields from returned data
    expect(meta.meetingId).toBe('test123');

    // But the file on disk keeps extra fields
    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'meeting.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(written.transcriptExtractedAt).toBe('2026-04-09T12:00:00Z');
  });
});
