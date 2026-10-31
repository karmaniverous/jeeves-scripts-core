/**
 * Tests for path extraction on both host styles (`path.win32` and
 * `path.posix`): drive, POSIX, configured-root and back-ticked relative
 * paths, inherited object keys that are no root, Slack markup, `..`, and
 * path comparison.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalAbsolute,
  extractPath,
  isWindows,
  type PathRoots,
  resolveToken,
  samePath,
} from './paths.js';

const WIN: PathRoots = {
  roots: { j: 'J:/' },
  relativeRoot: 'J:/',
  host: path.win32,
};
const POSIX: PathRoots = {
  roots: { j: '/opt/jeeves/' },
  relativeRoot: '/opt/jeeves',
  host: path.posix,
};

describe('isWindows', () => {
  it('tells the styles apart', () => {
    expect(isWindows(path.win32)).toBe(true);
    expect(isWindows(path.posix)).toBe(false);
  });
});

describe('canonicalAbsolute', () => {
  it.each([
    ['j:/domains/x/', 'J:/domains/x'],
    ['J:\\domains\\\\x', 'J:/domains/x'],
    ['c:/', 'C:/'],
  ])('win32: %s -> %s', (input, out) => {
    expect(canonicalAbsolute(input, path.win32)).toBe(out);
  });

  it.each([
    ['/srv//data/', '/srv/data'],
    ['/', '/'],
    ['/opt/jeeves/a', '/opt/jeeves/a'],
  ])('posix: %s -> %s', (input, out) => {
    expect(canonicalAbsolute(input, path.posix)).toBe(out);
  });

  it.each(['domains/x', 'J:x', 'J:/a/../b', '/srv/a', '\\\\server\\share'])(
    'win32 rejects %s',
    (input) => {
      expect(canonicalAbsolute(input, path.win32)).toBeUndefined();
    },
  );

  it.each(['domains/x', 'J:/a', 'j:\\a', '/a/../b'])(
    'posix rejects %s',
    (input) => {
      expect(canonicalAbsolute(input, path.posix)).toBeUndefined();
    },
  );
});

describe('resolveToken', () => {
  it.each([
    ['j/domains/projects/x', false, 'J:/domains/projects/x'],
    ['J/domains/x.', false, 'J:/domains/x'],
    ['j:/domains/x', false, 'J:/domains/x'],
    ['J:\\domains\\x', false, 'J:/domains/x'],
    ['j\\domains\\x', false, 'J:/domains/x'],
    ['domains/x', true, 'J:/domains/x'],
    ['(j/a/b),', false, 'J:/a/b'],
  ])('win32: %s (code: %s) -> %s', (token, code, out) => {
    expect(resolveToken(token, WIN, code)).toBe(out);
  });

  it.each([
    ['j/domains/projects/x', false, '/opt/jeeves/domains/projects/x'],
    ['j\\domains\\x', false, '/opt/jeeves/domains/x'],
    ['/srv/data/x', false, '/srv/data/x'],
    ['domains/x', true, '/opt/jeeves/domains/x'],
  ])('posix: %s (code: %s) -> %s', (token, code, out) => {
    expect(resolveToken(token, POSIX, code)).toBe(out);
  });

  it.each([
    ['domains/x', false],
    ['contracts', true],
    ['/approve', false],
    ['and/or', false],
    ['j/../etc', false],
    ['https://example.com/a', false],
  ])('ignores %s (code: %s) on both hosts', (token, code) => {
    expect(resolveToken(token, WIN, code)).toBeUndefined();
    expect(resolveToken(token, POSIX, code)).toBeUndefined();
  });

  it('ignores paths that name nothing on the host', () => {
    expect(resolveToken('/srv/data/x', WIN, false)).toBeUndefined();
    expect(resolveToken('J:/domains/x', POSIX, false)).toBeUndefined();
  });

  it.each(['constructor/home', 'toString/home', 'hasOwnProperty/home'])(
    'treats inherited key %s as no root, on both hosts',
    (token) => {
      for (const host of [path.posix, path.win32]) {
        const roots: PathRoots = { roots: { j: '/x' }, host };
        expect(resolveToken(token, roots, false)).toBeUndefined();
        const relativeRoot = host === path.posix ? '/opt' : 'J:/';
        expect(resolveToken(token, { ...roots, relativeRoot }, true)).toBe(
          host === path.posix ? `/opt/${token}` : `J:/${token}`,
        );
      }
    },
  );

  it('resolves a configured `constructor` root (an own key)', () => {
    const roots: PathRoots = {
      roots: { constructor: '/srv' },
      host: path.posix,
    };
    expect(resolveToken('constructor/a', roots, false)).toBe('/srv/a');
  });

  it('needs a relative root for relative paths', () => {
    expect(
      resolveToken('domains/x', { roots: {}, host: path.posix }, true),
    ).toBeUndefined();
  });
});

describe('extractPath', () => {
  it.each([
    [
      '<@U1> create directory `j/jgs/customers/bca` and seed meta.',
      'J:/jgs/customers/bca',
    ],
    [
      'create directory j/domains/projects/x and seed meta',
      'J:/domains/projects/x',
    ],
    [
      'Create directory `j:/domains/projects/status-board` and seed meta.',
      'J:/domains/projects/status-board',
    ],
    [
      'create folder `J:\\veterancrowd\\cto`. Seed meta.',
      'J:/veterancrowd/cto',
    ],
    [
      'create directory `domains/projects/furniture` and seed meta',
      'J:/domains/projects/furniture',
    ],
    ['seed meta at `j/a/b`. Copy `contracts` from `j/c/d`.', 'J:/a/b'],
    ['Set `"requireMention": false` and seed `j/a`', 'J:/a'],
    ['see <https://x.example/j/a|j/a> then `j/b/c` &amp; more', 'J:/b/c'],
    [
      'see <https://x.example|docs at J:/wrong now>, seed `j/right`',
      'J:/right',
    ],
  ])('win32: %s -> %s', (text, out) => {
    expect(extractPath(text, WIN)).toBe(out);
  });

  it.each([
    [
      'create directory `j/jgs/customers/bca` and seed meta.',
      '/opt/jeeves/jgs/customers/bca',
    ],
    ['seed meta in `J:\\old\\path` or `j/new/path`', '/opt/jeeves/new/path'],
    ['home directory `/srv/x/y`, seed meta', '/srv/x/y'],
  ])('posix: %s -> %s', (text, out) => {
    expect(extractPath(text, POSIX)).toBe(out);
  });

  it('finds nothing in prose', () => {
    expect(
      extractPath('seed meta; this is the home directory', WIN),
    ).toBeUndefined();
  });
});

describe('samePath', () => {
  it.each([
    ['J:/a/b', 'j:\\a\\b\\', true],
    ['J:/Projects/X', 'j:/projects/x', true],
    ['J:/A/b', 'j:/a/B', true],
    ['J:/a/b', 'J:/a/c', false],
    ['relative', 'RELATIVE', true],
  ])('win32: %s vs %s: %s', (a, b, same) => {
    expect(samePath(a, b, path.win32)).toBe(same);
  });

  it.each([
    ['/srv/a', '/srv/a/', true],
    ['/srv//a', '/srv/a', true],
    ['/srv/a', '/SRV/a', false],
    ['relative', 'relative', true],
  ])('posix: %s vs %s: %s', (a, b, same) => {
    expect(samePath(a, b, path.posix)).toBe(same);
  });
});
