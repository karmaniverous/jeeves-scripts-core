/**
 * `fileTranscript` without `live` (owner decision on #64): the response is
 * cached, so a following live run spends no second credit, and nothing
 * else is ever written.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fileTranscript,
  type FileTranscriptRequest,
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

/** Every file under the temp h.root, relative, sorted. */
const files = (): string[] =>
  readdirSync(h.root, { recursive: true })
    .map(String)
    .filter((p) => statSync(join(h.root, p)).isFile())
    .sort();

const CACHE = join('scratch', `${ID}.json`);

describe('fileTranscript without --live', () => {
  it('with nothing cached, reports the full result, caches the response and writes no transcript', async () => {
    h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
    const out = await fileTranscript(req({ keep: true, live: false }), deps());
    const path = join(h.dirs.libraryDir, PROTOTYPE_KEPT_NAME);
    expect(out).toEqual({
      code: 0,
      report: report(path, false, { kept: true, dryRun: true }),
    });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(readFileSync(join(h.dirs.scratchDir, `${ID}.json`), 'utf8')),
    ).toEqual(PROTOTYPE_RESPONSE);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(h.dirs.libraryDir)).toBe(false);
  });

  it('lets a following --live run use the cache with no API call', async () => {
    h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
    await fileTranscript(req({ keep: true, live: false }), deps());
    h.fetchMock.mockClear();
    const out = await fileTranscript(
      req({ keep: true }),
      deps({ apiKey: undefined }),
    );
    const path = join(h.dirs.libraryDir, PROTOTYPE_KEPT_NAME);
    expect(out).toEqual({
      code: 0,
      report: report(path, true, { kept: true }),
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe(PROTOTYPE_MARKDOWN);
  });

  it.each([
    ['a scratch copy', {}],
    ['--keep', { keep: true }],
    ['--dir', { dir: 'other' }],
    ['--out', { out: 'x.md' }],
    ['--force', { keep: true, force: true }],
  ])(
    'with %s writes nothing but the cache',
    async (_, over: Partial<FileTranscriptRequest>) => {
      h.fetchMock.mockResolvedValue(json(200, PROTOTYPE_RESPONSE));
      const r = req({
        ...over,
        ...(over.dir ? { dir: join(h.root, over.dir) } : {}),
        ...(over.out ? { out: join(h.root, over.out) } : {}),
        live: false,
      });
      const out = await fileTranscript(r, deps());
      expect(out.code).toBe(0);
      expect(files()).toEqual([CACHE]);
    },
  );

  it('with a cached response writes nothing at all', async () => {
    // Indented, so a rewrite (always compact) would show.
    const before = JSON.stringify(PROTOTYPE_RESPONSE, null, 2);
    seedCache(before);
    const cache = join(h.dirs.scratchDir, `${ID}.json`);
    const out = await fileTranscript(req({ live: false }), deps());
    expect(out.report).toMatchObject({ ok: true, cached: true, dryRun: true });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(files()).toEqual([CACHE]);
    expect(readFileSync(cache, 'utf8')).toBe(before);
  });
});
