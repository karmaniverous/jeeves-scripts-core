/**
 * Tests for `fileTranscript`: usage errors, the cache (no key needed), the
 * API call and its 404/408/error handling, the exists/force rules and the
 * report. A dry run: `file-transcript.dry-run.test.ts`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXIT,
  fileTranscript,
  TRANSCRIPT_API,
  USAGE,
} from './file-transcript.js';
import {
  ID,
  json,
  report,
  transcriptHarness,
} from './file-transcript.test-helper.js';
import {
  PROTOTYPE_KEPT_NAME,
  PROTOTYPE_MARKDOWN,
  PROTOTYPE_RESPONSE,
} from './render-markdown.fixtures.js';

const { h, deps, req, seedCache } = transcriptHarness();

describe('fileTranscript usage', () => {
  it.each([
    [{ positionals: [] }, USAGE],
    [{ positionals: [ID, 'extra'] }, 'unknown argument: extra'],
    [{ out: '/o.md', dir: '/d' }, '--out and --dir are mutually exclusive'],
    [{ positionals: ['nope'] }, 'cannot find a YouTube video id in: nope'],
  ])('exits 2 for %j', async (over, error) => {
    await expect(fileTranscript(req(over), deps())).resolves.toEqual({
      code: EXIT.usage,
      report: { ok: false, error },
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('pins the exit codes', () => {
    expect(EXIT).toEqual({
      ok: 0,
      usage: 2,
      noCaptions: 3,
      error: 4,
      exists: 5,
    });
  });
});

describe('fileTranscript with a cached response', () => {
  it('needs no key and no network, and writes the scratch copy', async () => {
    seedCache();
    const out = await fileTranscript(req(), deps({ apiKey: undefined }));
    const path = join(h.dirs.scratchDir, `${ID}.md`);
    expect(out).toEqual({ code: 0, report: report(path, true) });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe(PROTOTYPE_MARKDOWN);
  });

  it('refetches an unreadable cache', async () => {
    seedCache('{not json');
    h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
    const out = await fileTranscript(req(), deps());
    expect(out.report).toMatchObject({ ok: true, cached: false });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exits 4 when the cached response lacks a transcript', async () => {
    seedCache({ metadata: {} });
    await expect(fileTranscript(req(), deps())).resolves.toEqual({
      code: EXIT.error,
      report: { ok: false, error: 'response missing transcript or metadata' },
    });
  });
});

describe('fileTranscript fetching', () => {
  it('exits 4 with the exact error when there is no key and no cache', async () => {
    await expect(
      fileTranscript(req(), deps({ apiKey: undefined })),
    ).resolves.toEqual({
      code: EXIT.error,
      report: { ok: false, error: 'TRANSCRIPT_API_KEY is not set' },
    });
  });

  it('calls the API with the key and User-Agent, caches the raw response and files it', async () => {
    h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
    const out = await fileTranscript(req({ keep: true }), deps());
    const path = join(h.dirs.libraryDir, PROTOTYPE_KEPT_NAME);
    expect(out).toEqual({
      code: 0,
      report: report(path, false, { kept: true }),
    });
    const [url, init] = h.fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      `${TRANSCRIPT_API}?video_url=${ID}&format=json&include_timestamp=true&send_metadata=true`,
    );
    expect(init?.headers).toEqual({
      Authorization: 'Bearer tk-test',
      'User-Agent': 'jeeves-scripts/acme',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(
      JSON.parse(readFileSync(join(h.dirs.scratchDir, `${ID}.json`), 'utf8')),
    ).toEqual(PROTOTYPE_RESPONSE);
    expect(readFileSync(path, 'utf8')).toBe(PROTOTYPE_MARKDOWN);
  });

  it('exits 3 on 404', async () => {
    h.fetchMock.mockResolvedValue(json(404, 'nope'));
    await expect(fileTranscript(req(), deps())).resolves.toEqual({
      code: EXIT.noCaptions,
      report: {
        ok: false,
        error: 'no transcript: video not found or has no captions',
        status: 404,
      },
    });
  });

  it('exits 4 on another error status with a truncated body, without retrying', async () => {
    h.fetchMock.mockResolvedValue(json(500, 'x'.repeat(300)));
    await expect(fileTranscript(req(), deps())).resolves.toEqual({
      code: EXIT.error,
      report: {
        ok: false,
        error: 'TranscriptAPI HTTP 500',
        status: 500,
        body: 'x'.repeat(200),
      },
    });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });

  it('retries a 408 once after 2 s and succeeds', async () => {
    h.fetchMock
      .mockResolvedValueOnce(json(408, 'slow'))
      .mockResolvedValueOnce(json(200, PROTOTYPE_RESPONSE));
    const out = await fileTranscript(req(), deps());
    expect(out.code).toBe(0);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.sleep).toHaveBeenCalledExactlyOnceWith(2000);
  });

  it('exits 4 with the second 408 after one retry', async () => {
    h.fetchMock.mockResolvedValue(json(408, 'slow'));
    await expect(fileTranscript(req(), deps())).resolves.toEqual({
      code: EXIT.error,
      report: {
        ok: false,
        error: 'TranscriptAPI HTTP 408',
        status: 408,
        body: 'slow',
      },
    });
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exits 4 when the request fails, without retrying', async () => {
    h.fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(fileTranscript(req(), deps())).resolves.toEqual({
      code: EXIT.error,
      report: { ok: false, error: 'request failed: ECONNRESET' },
    });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exits 4 on a body that is not JSON', async () => {
    h.fetchMock.mockResolvedValue(json(200, '<html>'));
    await expect(fileTranscript(req(), deps())).resolves.toEqual({
      code: EXIT.error,
      report: { ok: false, error: 'TranscriptAPI returned invalid JSON' },
    });
  });
});

describe('fileTranscript exists and force', () => {
  it('refuses an existing --out before any fetch', async () => {
    const out = join(h.root, 'x.md');
    writeFileSync(out, 'old');
    await expect(fileTranscript(req({ out }), deps())).resolves.toEqual({
      code: EXIT.exists,
      report: {
        ok: false,
        error: 'file exists; pass --force to overwrite or choose --out',
        path: out,
      },
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an existing kept file after the fetch', async () => {
    const kept = join(h.dirs.libraryDir, PROTOTYPE_KEPT_NAME);
    mkdirSync(h.dirs.libraryDir, { recursive: true });
    writeFileSync(kept, 'old');
    h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
    await expect(fileTranscript(req({ keep: true }), deps())).resolves.toEqual({
      code: EXIT.exists,
      report: {
        ok: false,
        error: 'file exists; pass --force to overwrite or choose --out',
        path: kept,
      },
    });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(readFileSync(kept, 'utf8')).toBe('old');
  });

  it('--force overwrites a kept file and refetches despite the cache', async () => {
    seedCache({ ...PROTOTYPE_RESPONSE, language: 'stale' });
    const dir = join(h.root, 'other');
    const kept = join(dir, PROTOTYPE_KEPT_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(kept, 'old');
    h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
    const out = await fileTranscript(req({ dir, force: true }), deps());
    expect(out).toEqual({
      code: 0,
      report: report(kept, false, { kept: true }),
    });
    expect(readFileSync(kept, 'utf8')).toBe(PROTOTYPE_MARKDOWN);
  });

  it('always rewrites a scratch copy', async () => {
    seedCache();
    writeFileSync(join(h.dirs.scratchDir, `${ID}.md`), 'old');
    const out = await fileTranscript(req(), deps());
    expect(out.code).toBe(0);
    expect(readFileSync(join(h.dirs.scratchDir, `${ID}.md`), 'utf8')).toBe(
      PROTOTYPE_MARKDOWN,
    );
  });
});
