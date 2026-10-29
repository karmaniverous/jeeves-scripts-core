/**
 * Tests for the Fathom share-page path: candidate selection and staging
 * (over a temp meetings tree) and the page reader (over a scripted
 * browser and clock).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveChromePath } from './chrome-path.js';
import {
  fetchFathomSharePage,
  type ShareFetchBrowserDeps,
  type SharePage,
} from './fathom-share-fetch.js';
import {
  findShareMeetingsNeedingFetch,
  runFathomShareFetch,
} from './fathom-share-ingest.js';

const NOW = Date.parse('2026-03-03T12:00:00Z');
let dir: string;

const meeting = (
  id: string,
  meta: Record<string, unknown>,
  files: Record<string, string> = {},
) => {
  const mp = path.join(dir, id);
  fs.mkdirSync(mp, { recursive: true });
  fs.writeFileSync(
    path.join(mp, 'meeting.json'),
    JSON.stringify({
      meetingId: id,
      source: 'fathom',
      date: '2026-03-02',
      sortTimestampMs: 1,
      sortSource: 'email',
      ...meta,
    }),
  );
  for (const [f, body] of Object.entries(files))
    fs.writeFileSync(path.join(mp, f), body);
  return mp;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fathom-share-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('findShareMeetingsNeedingFetch', () => {
  it('selects share meetings with a link, no transcript and no recent fetch', () => {
    meeting(
      'a',
      { fathomKind: 'share' },
      { 'fathom_link.txt': 'https://fathom.video/share/A\n' },
    );
    meeting('b', {
      fathomKind: 'share',
      fathomUrl: 'https://fathom.video/share/B',
    });
    meeting(
      'done',
      { fathomKind: 'share', hasTranscript: true, fathomUrl: 'u' },
      { 'transcript.txt': 't' },
    );
    meeting('nolink', { fathomKind: 'share' });
    meeting('recent', {
      fathomKind: 'share',
      fathomUrl: 'u',
      fathomFetchedAt: new Date(NOW - 60_000).toISOString(),
    });
    meeting('html', { fathomKind: 'call', fathomUrl: 'u' });
    fs.mkdirSync(path.join(dir, '.hidden'));
    fs.mkdirSync(path.join(dir, 'nometa'));
    const found = findShareMeetingsNeedingFetch(
      [dir, path.join(dir, 'absent')],
      NOW,
    );
    expect(found.map((c) => [c.meetingId, c.fathomUrl]).sort()).toEqual([
      ['a', 'https://fathom.video/share/A'],
      ['b', 'https://fathom.video/share/B'],
    ]);
  });
});

describe('runFathomShareFetch', () => {
  it('writes transcripts and summaries, and counts empty and failed fetches', async () => {
    const a = meeting('a', { fathomKind: 'share', fathomUrl: 'A' });
    meeting('b', { fathomKind: 'share', fathomUrl: 'B' });
    meeting('c', { fathomKind: 'share', fathomUrl: 'C' });
    meeting('d', { fathomKind: 'share', fathomUrl: 'D' });
    const stats = await runFathomShareFetch(3, {
      meetingsDirs: () => [dir],
      fetchPage: (url) =>
        url === 'A'
          ? Promise.resolve({ summary: 'sum', transcript: 'words' })
          : url === 'B'
            ? Promise.resolve({ summary: '', transcript: '' })
            : Promise.reject(new Error('timeout')),
      now: () => NOW,
    });
    expect(stats).toEqual({ scanned: 4, candidates: 3, fetched: 1, errors: 2 });
    expect(fs.readFileSync(path.join(a, 'transcript.txt'), 'utf8')).toBe(
      'words',
    );
    expect(fs.readFileSync(path.join(a, 'summary.txt'), 'utf8')).toBe('sum');
    expect(
      JSON.parse(fs.readFileSync(path.join(a, 'meeting.json'), 'utf8')),
    ).toMatchObject({
      hasTranscript: true,
      fathomTranscriptSource: 'share-page',
      fathomFetchedAt: new Date(NOW).toISOString(),
    });
  });
});

describe('fetchFathomSharePage', () => {
  /** A browser whose page shows `bodies[tab]` as body text after `goto`. */
  const browserDeps = (
    bodies: Record<string, string[]>,
    opts: { failFirst?: string } = {},
  ) => {
    let clock = 0;
    let launches = 0;
    const closed: number[] = [];
    const deps: ShareFetchBrowserDeps = {
      chromePath: () => 'chrome',
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
      launch: () => {
        launches++;
        const n = launches;
        if (opts.failFirst && n === 1)
          return Promise.reject(new Error(opts.failFirst));
        let tab = '';
        const page = {
          goto: (url: string) => {
            tab = new URL(url).searchParams.get('tab') ?? '';
            return Promise.resolve(null);
          },
          evaluate: (fn: unknown) =>
            Promise.resolve(
              typeof fn === 'string' ? {} : (bodies[tab]?.shift() ?? ''),
            ),
        } as unknown as SharePage;
        return Promise.resolve({
          newPage: () => Promise.resolve(page),
          close: () => {
            closed.push(n);
            return Promise.resolve();
          },
        });
      },
    };
    return { deps, closed, launches: () => launches };
  };

  it('reads the summary and transcript after their copy markers', async () => {
    const b = browserDeps({
      summary: ['loading', 'Copy Summary\nThe summary'],
      transcript: ['Copy Transcript\nResume auto-scroll\nJane: hi'],
    });
    await expect(
      fetchFathomSharePage('https://fathom.video/share/X', b.deps),
    ).resolves.toEqual({
      summary: 'The summary',
      transcript: 'Jane: hi',
    });
    expect(b.closed).toEqual([1]);
  });

  it('retries a closed target and fails when the transcript stays empty', async () => {
    const retried = browserDeps(
      { summary: ['Copy Summary\nS'], transcript: ['Copy Transcript\nT'] },
      { failFirst: 'Target closed' },
    );
    await expect(
      fetchFathomSharePage('https://f/share/X', retried.deps),
    ).resolves.toEqual({ summary: 'S', transcript: 'T' });
    expect(retried.launches()).toBe(2);
    const empty = browserDeps({});
    await expect(
      fetchFathomSharePage('https://f/share/X', empty.deps),
    ).rejects.toThrow(
      'Transcript content empty after polling transcript tab URL',
    );
    expect(empty.launches()).toBe(3);
  });
});

describe('resolveChromePath', () => {
  it('uses an existing path from the environment and rejects a missing one', () => {
    const exe = path.join(dir, 'chrome');
    fs.writeFileSync(exe, '');
    vi.stubEnv('PUPPETEER_EXECUTABLE_PATH', exe);
    expect(resolveChromePath()).toBe(exe);
    vi.stubEnv('PUPPETEER_EXECUTABLE_PATH', path.join(dir, 'nope'));
    expect(() => resolveChromePath()).toThrow(
      'Chrome executable not found at path from environment',
    );
  });
});
