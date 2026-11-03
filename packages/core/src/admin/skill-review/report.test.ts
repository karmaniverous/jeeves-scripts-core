/**
 * Tests for the report contract (one section with a disposition, short
 * description and recommendation per proposal).
 */

import { describe, expect, it } from 'vitest';

import { validateReport } from './report.js';

const REPORT = `# Skill Workshop review

## Summary

Two approve, one approve-with-mods, one reject.

## Proposals

### a-1

**Skill:** a (create)

**Disposition:** Approve as is

**Short description:** Adds a step.

**Recommendation:** Apply as is.

### \`b.2\`

**Skill:** b (update)

**Disposition:** **Approve with modifications**

**Short description:** Rewrites the intro.

**Recommendation:** Apply, but trim the last paragraph.

### c-3

**Skill:** c (create)

**Disposition:** reject or decline

**Short description:** Duplicates skill d.

**Recommendation:** Decline; d already covers this.

### d-4

Text first.

**Disposition:** Not reviewed

**Short description:** Ran out of time to judge this one.

**Recommendation:** Cover it next run.
`;

describe('validateReport', () => {
  it('captures disposition, short description and recommendation per proposal', () => {
    expect(validateReport(REPORT, ['a-1', 'b.2', 'c-3', 'd-4'])).toEqual({
      entries: {
        'a-1': {
          disposition: 'Approve as is',
          shortDescription: 'Adds a step.',
          recommendation: 'Apply as is.',
        },
        'b.2': {
          disposition: 'Approve with modifications',
          shortDescription: 'Rewrites the intro.',
          recommendation: 'Apply, but trim the last paragraph.',
        },
        'c-3': {
          disposition: 'Reject or decline',
          shortDescription: 'Duplicates skill d.',
          recommendation: 'Decline; d already covers this.',
        },
        'd-4': {
          disposition: 'Not reviewed',
          shortDescription: 'Ran out of time to judge this one.',
          recommendation: 'Cover it next run.',
        },
      },
      counts: {
        'Approve as is': 1,
        'Approve with modifications': 1,
        'Reject or decline': 1,
        'Not reviewed': 1,
      },
    });
  });

  it('reads fields only inside their own section', () => {
    const report =
      '### a-1\n\nNo disposition.\n\n### b-2\n\n**Disposition:** Approve as is\n\n**Short description:** x\n\n**Recommendation:** y\n';
    expect(() => validateReport(report, ['a-1', 'b-2'])).toThrow(
      'a-1: no "**Disposition:** Approve as is|Approve with modifications|Reject or decline|Not reviewed" line',
    );
  });

  it('lists every problem', () => {
    const report = '### a-1\n\n**Disposition:** Maybe\n';
    expect(() => validateReport(report, ['a-1', 'x'])).toThrow(
      'Invalid review report: a-1: no "**Disposition:** Approve as is|Approve with modifications|Reject or decline|Not reviewed" line; a-1: no "**Short description:**" line; a-1: no "**Recommendation:**" line; no "### x" section',
    );
  });

  it.each([
    [
      'short description and recommendation',
      '**Disposition:** Approve as is\n',
      'a-1: no "**Short description:**" line; a-1: no "**Recommendation:**" line',
    ],
    [
      'recommendation',
      '**Disposition:** Approve as is\n\n**Short description:** x\n',
      'a-1: no "**Recommendation:**" line',
    ],
    [
      'disposition (an unknown label) and short description',
      '**Disposition:** Maybe\n\n**Recommendation:** y\n',
      'a-1: no "**Disposition:** Approve as is|Approve with modifications|Reject or decline|Not reviewed" line; a-1: no "**Short description:**" line',
    ],
  ])('reports every missing field together: %s', (_case, body, problems) => {
    expect(() => validateReport(`### a-1\n\n${body}`, ['a-1'])).toThrow(
      `Invalid review report: ${problems}`,
    );
  });

  it.each([
    [
      'an empty short description',
      '**Short description:**\n**Recommendation:** y',
      'Short description',
    ],
    [
      'a blank recommendation',
      '**Short description:** x\n**Recommendation:**   \n**Flags:** none',
      'Recommendation',
    ],
  ])(
    'treats %s as missing, never capturing the next line',
    (_c, fields, label) => {
      const report = `### a-1\n\n**Disposition:** Approve as is\n${fields}\n`;
      expect(() => validateReport(report, ['a-1'])).toThrow(
        `Invalid review report: a-1: no "**${label}:**" line`,
      );
    },
  );

  it.each([
    ['a glob', 'Keep scripts/*.ts as is', 'Keep scripts/*.ts as is'],
    ['code with an asterisk', 'Use `import * as fs`', 'Use `import * as fs`'],
    ['bold wrapping', '**Apply as is**', 'Apply as is'],
    ['italic wrapping', '*Apply as is*', 'Apply as is'],
  ])(
    'keeps inner asterisks and strips only outer emphasis: %s',
    (_c, raw, kept) => {
      const report = `### a-1\n\n**Disposition:** **Approve as is**\n\n**Short description:** x\n\n**Recommendation:** ${raw}\n`;
      expect(validateReport(report, ['a-1']).entries['a-1']).toEqual({
        disposition: 'Approve as is',
        shortDescription: 'x',
        recommendation: kept,
      });
    },
  );

  it('rejects a duplicate section for one proposal', () => {
    const report =
      '### a-1\n\n**Disposition:** Approve as is\n\n### `a-1`\n\n**Disposition:** Reject or decline\n';
    expect(() => validateReport(report, ['a-1'])).toThrow(
      'Invalid review report: 2 "### a-1" sections',
    );
  });

  it('rejects an empty report', () => {
    expect(() => validateReport('  ', [])).toThrow('the report is empty');
  });

  it('does not match an id as a prefix of another', () => {
    expect(() =>
      validateReport('### a-10\n\n**Disposition:** Approve as is\n', ['a-1']),
    ).toThrow('no "### a-1" section');
  });
});
