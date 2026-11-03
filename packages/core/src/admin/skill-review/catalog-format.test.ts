/**
 * Tests for the rebuilt `<available_skills>` catalog: XML escaping,
 * description shortening (whitespace, `...`, tiny caps, surrogate pairs),
 * the full and compact layouts line by line, and the `~/` locations.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CatalogSkill,
  escapeSkillXml,
  formatCompactCatalog,
  formatFullCatalog,
  promptLocation,
  truncateSkillDescription,
} from './catalog-format.js';

const HEADER = [
  '',
  '',
  'The following skills provide specialized instructions for specific tasks.',
];
const RELATIVE =
  'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.';

const SKILLS: CatalogSkill[] = [
  {
    name: 'a&b',
    description: 'Use <x> for "y"\'s  sake.',
    location: '/s/a/SKILL.md',
  },
  { name: 'c', description: '', location: '~/c/SKILL.md' },
];

describe('escapeSkillXml', () => {
  it('escapes the five XML characters, ampersands first', () => {
    expect(escapeSkillXml(`&lt; <a href="x">'y'</a>`)).toBe(
      '&amp;lt; &lt;a href=&quot;x&quot;&gt;&apos;y&apos;&lt;/a&gt;',
    );
  });
});

describe('truncateSkillDescription', () => {
  it.each([
    ['collapses whitespace and trims', '  a \n\t b  ', 10, 'a b'],
    ['keeps text at the cap', 'abcde', 5, 'abcde'],
    ['cuts with ... over the cap', 'abcdef', 5, 'ab...'],
    ['trims before the ...', 'ab cdef', 6, 'ab...'],
    ['cuts without ... at 3', 'abcdef', 3, 'abc'],
    ['cuts to 1', 'abcdef', 1, 'a'],
    ['never ends on half a pair', 'a\u{1F600}bcd', 5, 'a...'],
    ['keeps a whole pair', 'ab\u{1F600}cdef', 7, 'ab\u{1F600}...'],
    ['keeps a lone high surrogate', 'ab\uD800cdef', 6, 'ab\uD800...'],
    ['cuts before a pair at a tiny cap', '\u{1F600}abc', 1, ''],
  ])('%s', (_case, input, max, expected) => {
    expect(truncateSkillDescription(input, max)).toBe(expected);
  });
});

describe('formatFullCatalog', () => {
  it('is empty for no skills', () => {
    expect(formatFullCatalog([])).toBe('');
  });

  it('lists every skill with its raw description, escaped', () => {
    expect(formatFullCatalog(SKILLS).split('\n')).toEqual([
      ...HEADER,
      "Read a skill's file at its listed location when the task matches its description.",
      RELATIVE,
      '',
      '<available_skills>',
      '  <skill>',
      '    <name>a&amp;b</name>',
      '    <description>Use &lt;x&gt; for &quot;y&quot;&apos;s  sake.</description>',
      '    <location>/s/a/SKILL.md</location>',
      '  </skill>',
      '  <skill>',
      '    <name>c</name>',
      '    <description></description>',
      '    <location>~/c/SKILL.md</location>',
      '  </skill>',
      '</available_skills>',
    ]);
  });
});

describe('formatCompactCatalog', () => {
  it('is empty for no skills', () => {
    expect(formatCompactCatalog([], 10)).toBe('');
  });

  it('shortens descriptions and drops empty ones', () => {
    expect(formatCompactCatalog(SKILLS, 10).split('\n')).toEqual([
      ...HEADER,
      "Read a skill's file at its listed location when the task matches its name or description.",
      RELATIVE,
      '',
      '<available_skills>',
      '  <skill>',
      '    <name>a&amp;b</name>',
      '    <description>Use &lt;x&gt;...</description>',
      '    <location>/s/a/SKILL.md</location>',
      '  </skill>',
      '  <skill>',
      '    <name>c</name>',
      '    <location>~/c/SKILL.md</location>',
      '  </skill>',
      '</available_skills>',
    ]);
  });

  it('omits every description at 0', () => {
    const lines = formatCompactCatalog(SKILLS, 0).split('\n');
    expect(lines[3]).toBe(
      "Read a skill's file at its listed location when the task matches its name.",
    );
    expect(lines.filter((l) => l.includes('<description>'))).toEqual([]);
  });
});

describe('promptLocation', () => {
  const home = path.resolve('/users/me');

  it('shows a path under the home as ~/', () => {
    expect(promptLocation(path.join(home, 's', 'SKILL.md'), [home])).toBe(
      '~/s/SKILL.md',
    );
  });

  it('accepts a home given with a trailing separator', () => {
    expect(promptLocation(path.join(home, 'x'), [home + path.sep])).toBe('~/x');
  });

  it('tries the longest home first', () => {
    const inner = path.join(home, 'inner');
    expect(
      promptLocation(path.join(inner, 'SKILL.md'), [home, inner, home]),
    ).toBe('~/SKILL.md');
  });

  it('leaves other paths, and the home itself, unchanged', () => {
    const other = path.resolve('/opt/skills/SKILL.md');
    expect(promptLocation(other, [home])).toBe(other);
    expect(promptLocation(home, [home])).toBe(home);
    expect(promptLocation(`${home}x${path.sep}y`, [home])).toBe(
      `${home}x${path.sep}y`,
    );
  });

  it('matches a Windows-style home by backslash on any platform, slashes after ~', () => {
    expect(
      promptLocation('C:\\Users\\Me\\.openclaw\\s\\SKILL.md', [
        'C:\\Users\\Me',
      ]),
    ).toBe('~/.openclaw/s/SKILL.md');
  });

  it('adds no second backslash to a Windows-style home ending in one', () => {
    // POSIX: the only prefix is `C:\h\/`, so a doubled backslash never
    // matches; Windows: the home itself is the prefix.
    expect(promptLocation('C:\\h\\\\x', ['C:\\h\\'])).toBe(
      path.sep === '/' ? 'C:\\h\\\\x' : '~//x',
    );
  });

  it('keeps backslashes after a POSIX home', () => {
    expect(promptLocation('/home/me/a\\b', ['/home/me'])).toBe(
      path.sep === '/' ? '~/a\\b' : '/home/me/a\\b',
    );
  });
});
