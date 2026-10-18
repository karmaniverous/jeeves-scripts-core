import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchNotes,
  type FetchNotesDeps,
  fetchNotesDeps,
  findMeetingsNeedingFetch,
  MAX_FATHOM_PER_RUN,
  MAX_FATHOM_SHARE_PER_RUN,
} from './fetch-notes.js';
import type { ShareCandidate } from './lib/fathom-share-ingest.js';

let dir: string;
let logs: string[];

const pkg = (id: string, files: string[]) => {
  const mp = path.join(dir, id);
  fs.mkdirSync(mp, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(mp, f), '');
};

const deps = (over: Partial<FetchNotesDeps> = {}): FetchNotesDeps => ({
  meetingsDirs: () => [dir, path.join(dir, 'absent')],
  shareCandidates: () => [],
  docFetch: vi.fn(() => Promise.resolve()),
  fathomExtract: vi.fn(),
  shareFetch: vi.fn(() => Promise.resolve({ fetched: 1, errors: 0 })),
  now: () => '2026-03-03T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-notes-'));
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('findMeetingsNeedingFetch', () => {
  it('sorts packages without a transcript by Gemini link or Fathom HTML', () => {
    pkg('g', ['gemini_link.txt']);
    pkg('f', ['fathom-1.html']);
    pkg('done', ['gemini_link.txt', 'transcript.txt']);
    pkg('none', ['notes.md']);
    fs.writeFileSync(path.join(dir, 'index.json'), '{}');
    expect(findMeetingsNeedingFetch([dir])).toEqual({
      geminiNeeded: ['g'],
      fathomNeeded: ['f'],
    });
  });
});

describe('fetchNotes', () => {
  it('reports nothing to fetch, as JSON in a dry run', async () => {
    await fetchNotes({ dryRun: false }, deps());
    expect(logs).toEqual([
      '[2026-03-03T00:00:00.000Z] No meetings need transcript fetching',
    ]);
    logs = [];
    await fetchNotes({ dryRun: true }, deps());
    expect(JSON.parse(logs[0] ?? '{}')).toEqual({
      skip: true,
      reason: 'No meetings need transcript fetching',
    });
  });

  it('lists the work in a dry run without fetching', async () => {
    pkg('g', ['gemini_link.txt']);
    const d = deps({
      shareCandidates: () => [{ meetingId: 's1' } as ShareCandidate],
    });
    await fetchNotes({ dryRun: true }, d);
    expect(JSON.parse(logs.at(-1) ?? '{}')).toEqual({
      skip: false,
      geminiNeeded: ['g'],
      fathomNeeded: [],
      fathomShareNeeded: ['s1'],
    });
    expect(d.docFetch).not.toHaveBeenCalled();
  });

  it('runs every fetcher with its cap', async () => {
    pkg('f', ['fathom-1.html']);
    const d = deps({
      shareCandidates: () => [{ meetingId: 's1' } as ShareCandidate],
    });
    await fetchNotes({ dryRun: false }, d);
    expect(d.docFetch).toHaveBeenCalled();
    expect(d.fathomExtract).toHaveBeenCalledWith({
      max: MAX_FATHOM_PER_RUN,
    });
    expect(d.shareFetch).toHaveBeenCalledWith(MAX_FATHOM_SHARE_PER_RUN);
    expect(logs).toContain(
      '[2026-03-03T00:00:00.000Z] Fathom share fetch: 1 fetched, 0 errors',
    );
  });
});

describe('fetchNotesDeps', () => {
  it('lists the meetings directories from config', () => {
    expect(fetchNotesDeps().meetingsDirs().length).toBeGreaterThan(0);
  });
});
