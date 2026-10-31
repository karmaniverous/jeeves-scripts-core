/**
 * Tests for which workspaces' channels the report may name with their
 * text: the configured list over the report target's account, none when
 * neither is known, and per-workspace counts for the rest.
 */

import { describe, expect, it } from 'vitest';

import { scopedLines, textAccountsFor } from './text-scope.js';

describe('textAccountsFor', () => {
  it.each([
    [undefined, 'default', ['default']],
    [undefined, undefined, []],
    [['globex', 'x'], 'default', ['globex', 'x']],
    [[], 'default', []],
  ])('configured %j, target %s: %j', (configured, target, shown) => {
    expect([...textAccountsFor(configured, target)]).toEqual(shown);
  });
});

describe('scopedLines', () => {
  it('keeps shown accounts\u2019 bullets in order and counts the rest per account, first seen first', () => {
    expect(
      scopedLines(
        [
          { account: 'globex', line: 'v1' },
          { account: 'default', line: 'd1' },
          { account: 'x', line: 'x1' },
          { account: 'globex', line: 'v2' },
          { account: 'default', line: 'd2' },
        ],
        new Set(['default']),
      ),
    ).toEqual([
      'd1',
      'd2',
      '2 channel(s) in `globex` (text not shown outside that workspace)',
      '1 channel(s) in `x` (text not shown outside that workspace)',
    ]);
  });

  it('counts everything when nothing is shown, and returns nothing for nothing', () => {
    expect(scopedLines([{ account: 'a', line: 'l' }], new Set())).toEqual([
      '1 channel(s) in `a` (text not shown outside that workspace)',
    ]);
    expect(scopedLines([], new Set(['a']))).toEqual([]);
  });
});
