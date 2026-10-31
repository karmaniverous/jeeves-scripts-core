/**
 * Tests for the home-directory sweep: extraction from people's posts
 * only, latest assignment wins (also over an earlier run's), a post whose
 * path can't be read skipped and listed, and the
 * comparison with the configured home directory.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bot, human, settingsFrom, ts } from './fakes.test-helper.js';
import type { PathRoots } from './paths.js';
import {
  compareAssignment,
  isAssignmentText,
  latestAssignment,
} from './sweep.js';

const settings = settingsFrom({
  pathRoots: { j: 'J:/' },
  relativeRoot: 'J:/',
});
const { sweepPatterns: patterns, pathRoots: roots } = settings;

describe('isAssignmentText', () => {
  it.each([
    ['create `j/a` and seed meta. This will be the home directory.', true],
    ['Seeded meta in `j/a`; it is the home dir', true],
    ['seeding meta at j/a, home directory for this channel', true],
    ['seed meta in `j/a`', false],
    ['this is the home directory `j/a`', false],
  ])('%s: %s', (text, match) => {
    expect(isAssignmentText(text, patterns)).toBe(match);
  });
});

describe('latestAssignment', () => {
  const assign = (s: number, p: string) =>
    human(
      s,
      `create directory \`${p}\` and seed meta. This will be the home directory for this channel.`,
    );

  it('takes the latest person post with a path, whatever the order', () => {
    expect(
      latestAssignment(
        [assign(30, 'j/new'), assign(10, 'j/old'), assign(20, 'j/mid')],
        patterns,
        roots,
      ).assignment,
    ).toEqual({ ts: ts(30), path: 'J:/new' });
  });

  it('skips bot posts, posts without a path and non-matching posts', () => {
    expect(
      latestAssignment(
        [
          assign(10, 'j/person'),
          { ...bot(20, ''), text: 'seed meta in `j/bot`, the home directory' },
          human(30, 'seed meta; home directory to follow'),
          human(40, 'look at `j/elsewhere`'),
          { ts: ts(50), user: 'U1' },
        ],
        patterns,
        roots,
      ),
    ).toEqual({ assignment: { ts: ts(10), path: 'J:/person' }, failed: [] });
  });

  it('keeps an earlier run’s assignment unless a newer one appears', () => {
    const previous = { ts: ts(15), path: 'J:/before' };
    expect(latestAssignment([], patterns, roots, previous).assignment).toBe(
      previous,
    );
    expect(
      latestAssignment([assign(10, 'j/older')], patterns, roots, previous)
        .assignment,
    ).toBe(previous);
    expect(
      latestAssignment([assign(20, 'j/newer')], patterns, roots, previous)
        .assignment,
    ).toEqual({
      ts: ts(20),
      path: 'J:/newer',
    });
  });

  it('finds nothing in an empty channel', () => {
    expect(latestAssignment([], patterns, roots)).toEqual({ failed: [] });
  });

  it('skips and lists a post whose path can\u2019t be read, and goes on', () => {
    const throwing: PathRoots = {
      ...roots,
      host: {
        ...path.win32,
        get sep(): typeof path.sep {
          throw new Error('unreadable root');
        },
      },
    };
    expect(
      latestAssignment(
        [assign(10, 'j/a'), assign(20, 'j/b')],
        patterns,
        throwing,
        { ts: ts(5), path: 'J:/kept' },
      ),
    ).toEqual({
      assignment: { ts: ts(5), path: 'J:/kept' },
      failed: [
        { ts: ts(10), error: 'unreadable root' },
        { ts: ts(20), error: 'unreadable root' },
      ],
    });
  });
});

describe('compareAssignment', () => {
  const at = { ts: ts(1), path: 'J:/a' };
  const exists = (yes: boolean) => () => yes;

  it.each([
    ['no assignment', undefined, 'J:/a', true, undefined],
    [
      'unconfigured, on disk',
      at,
      undefined,
      true,
      { kind: 'proposal', path: 'J:/a' },
    ],
    [
      'unconfigured, missing',
      at,
      undefined,
      false,
      { kind: 'missing-dir', path: 'J:/a' },
    ],
    ['configured the same (case, slashes)', at, 'j:\\a\\', true, undefined],
    [
      'configured differently',
      at,
      'J:/b',
      true,
      { kind: 'mismatch', path: 'J:/a', configured: 'J:/b', exists: true },
    ],
    [
      'configured differently, missing',
      at,
      'J:/b',
      false,
      { kind: 'mismatch', path: 'J:/a', configured: 'J:/b', exists: false },
    ],
  ] as const)('%s', (_label, assignment, configured, onDisk, finding) => {
    expect(
      compareAssignment(assignment, configured, exists(onDisk), path.win32),
    ).toEqual(finding);
  });

  it('compares POSIX paths case-sensitively on a POSIX host', () => {
    const posix = { ts: ts(1), path: '/opt/jeeves/a' };
    expect(
      compareAssignment(posix, '/opt/jeeves/a/', exists(true), path.posix),
    ).toBeUndefined();
    expect(
      compareAssignment(posix, '/opt/jeeves/A', exists(true), path.posix),
    ).toEqual({
      kind: 'mismatch',
      path: '/opt/jeeves/a',
      configured: '/opt/jeeves/A',
      exists: true,
    });
  });
});
