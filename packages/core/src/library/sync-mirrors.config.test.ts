/**
 * `library-sync-mirrors` and the config (Decision 76): with no `library`
 * block, `config check` passes and the runnable skips with exit 0; with an
 * invalid one, `config check`, its prerequisite and its run all fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configCheck } from '../config/check.js';
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

  it('passes config check and skips with no block', async () => {
    expect(configCheck(write({})).ok).toBe(true);
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
  ])(
    'fails config check, its prerequisite and the run on %s',
    (_what, mirrors, message) => {
      const result = configCheck(write({ library: { mirrors } }));
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(message);
      expect(() => libraryJob.prerequisite?.({ args: [] })).toThrow(message);
      expect(() => libraryJob.run({ args: [], flags: {} })).toThrow(message);
    },
  );
});
