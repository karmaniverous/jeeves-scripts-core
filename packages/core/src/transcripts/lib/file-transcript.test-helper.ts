/**
 * @module transcripts/lib/file-transcript.test-helper
 *
 * Test helper for the `fileTranscript` tests: a fresh temp root with
 * library and scratch directories, a mocked fetch and sleep per test, and
 * the request, deps, cache-seeding and report builders. Not built or
 * shipped.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, vi } from 'vitest';

import type {
  FileTranscriptDeps,
  FileTranscriptRequest,
} from './file-transcript.js';
import type { TranscriptDirs } from './paths.js';
import {
  PROTOTYPE_RESPONSE,
  PROTOTYPE_RETRIEVED,
} from './render-markdown.fixtures.js';

/** The prototype video id. */
export const ID = 'dQw4w9WgXcQ';

/** A response with a JSON (or raw string) body. */
export const json = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });

/** The success report for the prototype response. */
export const report = (path: string, cached: boolean, over: object = {}) => ({
  ok: true,
  kept: false,
  cached,
  dryRun: false,
  path,
  video_id: ID,
  title: 'Café Design: It’s "Simple" (Part 1)',
  author: "Ana Example's Channel",
  length: '1:00:12',
  segments: 5,
  words: 21,
  ...over,
});

/** The per-test state, reset before each test. */
interface TranscriptHarness {
  root: string;
  dirs: TranscriptDirs;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;
}

/**
 * Register the per-test reset and return the live state plus builders.
 * Call once at the top of a test file.
 */
export const transcriptHarness = () => {
  const h = {} as TranscriptHarness;
  beforeEach(() => {
    h.root = mkdtempSync(join(tmpdir(), 'yt-'));
    h.dirs = {
      libraryDir: join(h.root, 'lib'),
      scratchDir: join(h.root, 'scratch'),
    };
    h.fetchMock = vi.fn<typeof fetch>();
    h.sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  });

  const deps = (
    over: Partial<FileTranscriptDeps> = {},
  ): FileTranscriptDeps => ({
    dirs: h.dirs,
    userAgent: 'jeeves-scripts/acme',
    apiKey: 'tk-test',
    fetch: h.fetchMock,
    now: () => new Date(`${PROTOTYPE_RETRIEVED}T12:00:00Z`),
    sleep: h.sleep,
    ...over,
  });

  const req = (
    over: Partial<FileTranscriptRequest> = {},
  ): FileTranscriptRequest => ({
    positionals: [ID],
    keep: false,
    force: false,
    live: true,
    ...over,
  });

  const seedCache = (body: unknown = PROTOTYPE_RESPONSE): void => {
    mkdirSync(h.dirs.scratchDir, { recursive: true });
    writeFileSync(
      join(h.dirs.scratchDir, `${ID}.json`),
      typeof body === 'string' ? body : JSON.stringify(body),
    );
  };

  return { h, deps, req, seedCache };
};
