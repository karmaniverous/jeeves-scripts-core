/**
 * Tests for transcript path resolution: the cache, the scratch copy and
 * the kept file under `--keep`, `--dir` and `--out`.
 */

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cachePath, isKept, targetPath } from './paths.js';

const dirs = { libraryDir: resolve('/lib'), scratchDir: resolve('/scratch') };

describe('cachePath', () => {
  it('is <scratchDir>/<id>.json', () => {
    expect(cachePath(dirs.scratchDir, 'abc')).toBe(
      join(dirs.scratchDir, 'abc.json'),
    );
  });
});

describe('isKept', () => {
  it.each([
    [{ keep: false }, false],
    [{ keep: true }, true],
    [{ keep: false, dir: '/d' }, true],
    [{ keep: false, out: '/o.md' }, true],
  ])('%j kept: %s', (flags, kept) => {
    expect(isKept(flags)).toBe(kept);
  });
});

describe('targetPath', () => {
  it('is the scratch copy by video id unless kept', () => {
    expect(targetPath({ keep: false }, dirs, 'abc', 'name.md')).toBe(
      join(dirs.scratchDir, 'abc.md'),
    );
  });

  it('is the kept name in the library with --keep', () => {
    expect(targetPath({ keep: true }, dirs, 'abc', 'name.md')).toBe(
      join(dirs.libraryDir, 'name.md'),
    );
  });

  it('is the kept name in --dir', () => {
    expect(
      targetPath(
        { keep: false, dir: resolve('/other') },
        dirs,
        'abc',
        'name.md',
      ),
    ).toBe(join(resolve('/other'), 'name.md'));
  });

  it('is exactly --out, resolved', () => {
    expect(
      targetPath({ keep: false, out: 'rel/x.md' }, dirs, 'abc', 'name.md'),
    ).toBe(resolve('rel/x.md'));
  });
});
