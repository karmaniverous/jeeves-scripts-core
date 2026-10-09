import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findShareMeetingsNeedingFetch } from './fathom-share-ingest.js';

// Mock getMeetingsDirs to return our temp directory
vi.mock('./meetings-dirs.js', () => ({
  getMeetingsDirs: vi.fn(),
}));

const { getMeetingsDirs } = await import('./meetings-dirs.js');
const mockedGetMeetingsDirs = vi.mocked(getMeetingsDirs);

describe('findShareMeetingsNeedingFetch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-ingest-test-'));
    mockedGetMeetingsDirs.mockReturnValue([tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMeeting(
    id: string,
    meta: Record<string, unknown>,
    files?: Record<string, string>,
  ): void {
    const dir = path.join(tmpDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'meeting.json'),
      JSON.stringify(meta),
      'utf8',
    );
    if (files) {
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
      }
    }
  }

  it('finds share meetings missing transcript', () => {
    createMeeting(
      'meeting-a',
      {
        meetingId: 'meeting-a',
        source: 'fathom',
        date: '2026-04-09',
        sortTimestampMs: null,
        sortSource: 'fallback',
        hasTranscript: false,
        fathomKind: 'share',
        fathomUrl: 'https://fathom.video/share/abc',
      },
      { 'fathom_link.txt': 'https://fathom.video/share/abc\n' },
    );

    const candidates = findShareMeetingsNeedingFetch();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].meetingId).toBe('meeting-a');
  });

  it('skips share meetings that already have transcript', () => {
    createMeeting(
      'meeting-b',
      {
        meetingId: 'meeting-b',
        source: 'fathom',
        date: '2026-04-09',
        sortTimestampMs: null,
        sortSource: 'fallback',
        hasTranscript: true,
        fathomKind: 'share',
        fathomUrl: 'https://fathom.video/share/xyz',
      },
      {
        'fathom_link.txt': 'https://fathom.video/share/xyz\n',
        'transcript.txt': 'Some transcript content',
      },
    );

    const candidates = findShareMeetingsNeedingFetch();
    expect(candidates).toHaveLength(0);
  });

  it('skips call meetings', () => {
    createMeeting('meeting-c', {
      meetingId: 'meeting-c',
      source: 'fathom',
      date: '2026-04-09',
      sortTimestampMs: null,
      sortSource: 'fallback',
      hasTranscript: false,
      fathomKind: 'call',
      fathomUrl: 'https://fathom.video/calls/xyz',
    });

    const candidates = findShareMeetingsNeedingFetch();
    expect(candidates).toHaveLength(0);
  });

  it('skips meetings in cooldown', () => {
    createMeeting(
      'meeting-d',
      {
        meetingId: 'meeting-d',
        source: 'fathom',
        date: '2026-04-09',
        sortTimestampMs: null,
        sortSource: 'fallback',
        hasTranscript: false,
        fathomKind: 'share',
        fathomUrl: 'https://fathom.video/share/def',
        fathomFetchedAt: new Date().toISOString(), // just now
      },
      { 'fathom_link.txt': 'https://fathom.video/share/def\n' },
    );

    const candidates = findShareMeetingsNeedingFetch();
    expect(candidates).toHaveLength(0);
  });

  it('reads fathomUrl from fathom_link.txt when not in metadata', () => {
    createMeeting(
      'meeting-e',
      {
        meetingId: 'meeting-e',
        source: 'fathom',
        date: '2026-04-09',
        sortTimestampMs: null,
        sortSource: 'fallback',
        hasTranscript: false,
        fathomKind: 'share',
      },
      { 'fathom_link.txt': 'https://fathom.video/share/fromfile\n' },
    );

    const candidates = findShareMeetingsNeedingFetch();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].fathomUrl).toBe('https://fathom.video/share/fromfile');
  });
});
