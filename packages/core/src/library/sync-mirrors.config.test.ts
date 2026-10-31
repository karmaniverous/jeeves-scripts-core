/**
 * `library-sync-mirrors` and the config (Decision 76): with no `library`
 * block it skips with exit 0; with an invalid one its prerequisite and its
 * run fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConfigFile } from '../config/config-file.test-helper.js';
import libraryJob from './sync-mirrors.js';

const mirror = { id: 'docs', repo: 'acme/docs', dest: 'library/docs' };

describe('library-sync-mirrors and the library block', () => {
  const write = useConfigFile();
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips with no block', async () => {
    write({});
    expect(await libraryJob.prerequisite?.({ args: [] })).toBe(
      'no library.mirrors configured',
    );
    await libraryJob.run({ args: [] });
    expect(console.log).toHaveBeenCalledWith(
      '[skip] no library.mirrors configured',
    );
  });

  it.each([
    [
      'a duplicate mirror id',
      [mirror, { ...mirror, dest: 'other' }],
      /duplicate mirror id/,
    ],
    ['a dest under .meta', [{ ...mirror, dest: '.meta/docs' }], /under \.meta/],
    [
      'two mirrors sharing a dest',
      [mirror, { ...mirror, id: 'b' }],
      /overlaps mirror "docs"/,
    ],
  ])('fails its prerequisite and run on %s', (_what, mirrors, message) => {
    write({ library: { mirrors } });
    expect(() => libraryJob.prerequisite?.({ args: [] })).toThrow(message);
    expect(() => libraryJob.run({ args: [], flags: {} })).toThrow(message);
  });
});
