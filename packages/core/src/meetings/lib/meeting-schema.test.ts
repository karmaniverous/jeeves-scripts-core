import { describe, expect, it } from 'vitest';

import {
  computeSortTimestamp,
  meetingMetaSchema,
  parseMeetingMeta,
  validateRequiredFields,
} from './meeting-schema.js';

describe('meetingMetaSchema', () => {
  it('validates a complete meeting metadata object', () => {
    const meta = {
      meetingId: 'abc123',
      source: 'fathom',
      date: '2026-04-09',
      sortTimestampMs: 1712678400000,
      sortSource: 'email-internalDateMs',
      hasTranscript: true,
      title: 'Weekly Sync',
    };
    const result = meetingMetaSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });

  it('validates with null sortTimestampMs', () => {
    const meta = {
      meetingId: 'abc123',
      source: 'gemini',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
    };
    expect(meetingMetaSchema.safeParse(meta).success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const meta = { meetingId: 'abc123' };
    expect(meetingMetaSchema.safeParse(meta).success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const meta = {
      meetingId: 'abc123',
      source: 'fathom',
      date: 'April 9, 2026',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
    };
    expect(meetingMetaSchema.safeParse(meta).success).toBe(false);
  });

  it('validates fathom-specific fields', () => {
    const meta = {
      meetingId: 'abc123',
      source: 'fathom',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: true,
      fathomKind: 'share',
      fathomUrl: 'https://fathom.video/share/abc',
      fathomFetchedAt: '2026-04-09T12:00:00Z',
      fathomTranscriptSource: 'share-page',
    };
    expect(meetingMetaSchema.safeParse(meta).success).toBe(true);
  });

  it('rejects invalid fathomKind', () => {
    const meta = {
      meetingId: 'abc123',
      source: 'fathom',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
      fathomKind: 'invalid',
    };
    expect(meetingMetaSchema.safeParse(meta).success).toBe(false);
  });
});

describe('parseMeetingMeta', () => {
  it('returns parsed meta for valid input', () => {
    const meta = {
      meetingId: 'test',
      source: 'gemini',
      date: '2026-01-01',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
    };
    expect(parseMeetingMeta(meta)).toEqual(meta);
  });

  it('returns null for invalid input', () => {
    expect(parseMeetingMeta({ foo: 'bar' })).toBeNull();
  });
});

describe('validateRequiredFields', () => {
  it('passes for complete required fields', () => {
    const meta = {
      meetingId: 'abc',
      source: 'fathom',
      date: '2026-04-09',
      sortTimestampMs: 1000,
      sortSource: 'email-internalDateMs',
      hasTranscript: true,
    };
    expect(validateRequiredFields(meta).success).toBe(true);
  });

  it('fails for missing source', () => {
    const meta = {
      meetingId: 'abc',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
    };
    expect(validateRequiredFields(meta).success).toBe(false);
  });
});

describe('computeSortTimestamp', () => {
  it('prefers meeting timestamp', () => {
    const result = computeSortTimestamp({
      meetingTimestampMs: 1000,
      emailInternalDateMs: 2000,
    });
    expect(result).toEqual({
      sortTimestampMs: 1000,
      sortSource: 'meeting-timestamp',
    });
  });

  it('falls back to email internalDateMs', () => {
    const result = computeSortTimestamp({
      emailInternalDateMs: 2000,
    });
    expect(result).toEqual({
      sortTimestampMs: 2000,
      sortSource: 'email-internalDateMs',
    });
  });

  it('falls back to filename date', () => {
    const result = computeSortTimestamp({
      filenameDateStr: '2026-04-09',
    });
    expect(result.sortSource).toBe('filename-date');
    expect(result.sortTimestampMs).toBeTypeOf('number');
  });

  it('falls back to package createdAt', () => {
    const result = computeSortTimestamp({
      packageCreatedAt: '2026-04-09T12:00:00Z',
    });
    expect(result.sortSource).toBe('package-createdAt');
  });

  it('returns null with fallback source when nothing available', () => {
    const result = computeSortTimestamp({});
    expect(result).toEqual({ sortTimestampMs: null, sortSource: 'fallback' });
  });
});

describe('computeSortTimestamp — migration precedence', () => {
  it('meetingTimestampMs wins over all other sources', () => {
    const result = computeSortTimestamp({
      meetingTimestampMs: 1000,
      emailInternalDateMs: 2000,
      filenameDateStr: '2026-01-01',
      packageCreatedAt: '2026-02-01T00:00:00Z',
    });
    expect(result).toEqual({
      sortTimestampMs: 1000,
      sortSource: 'meeting-timestamp',
    });
  });

  it('filenameDateStr wins over packageCreatedAt', () => {
    const result = computeSortTimestamp({
      filenameDateStr: '2026-03-15',
      packageCreatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.sortSource).toBe('filename-date');
  });

  it('ignores invalid filenameDateStr and falls through', () => {
    const result = computeSortTimestamp({
      filenameDateStr: 'not-a-date',
      packageCreatedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.sortSource).toBe('package-createdAt');
  });
});
