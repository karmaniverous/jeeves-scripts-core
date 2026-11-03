/**
 * Tests for the SKILL.md frontmatter reader: the scalar and block forms
 * skills use, and texts without frontmatter.
 */

import { describe, expect, it } from 'vitest';

import { parseSkillFrontmatter } from './frontmatter.js';

describe('parseSkillFrontmatter', () => {
  it.each([
    ['plain', 'name: a-skill\ndescription: Does things.', 'Does things.'],
    [
      'double-quoted with escapes',
      'name: "a-skill"\ndescription: "Say \\"hi\\" here"',
      'Say "hi" here',
    ],
    [
      'double-quoted, invalid JSON',
      'name: a-skill\ndescription: "bad \\q escape"',
      'bad \\q escape',
    ],
    [
      'single-quoted',
      "name: 'a-skill'\ndescription: 'It''s here'",
      "It's here",
    ],
    [
      'folded block',
      'name: a-skill\ndescription: >\n  First line\n  second line.\n\nmetadata: {}',
      'First line second line.',
    ],
    [
      'literal block',
      'name: a-skill\ndescription: |-\n  One\n  Two',
      'One\nTwo',
    ],
  ])('reads a %s description', (_label, fm, description) => {
    expect(parseSkillFrontmatter(`---\n${fm}\n---\n\n# Body\n`)).toEqual({
      name: 'a-skill',
      description,
    });
  });

  it.each([
    ['a plain scalar', 'name: a-skill # the id', 'a-skill'],
    ['a double-quoted scalar', 'name: "a-skill" # the id', 'a-skill'],
    ['a single-quoted scalar', "name: 'a-skill' # it''s", 'a-skill'],
  ])('drops an inline comment after %s', (_label, fm, name) => {
    expect(parseSkillFrontmatter(`---\n${fm}\n---\n`)).toEqual({ name });
  });

  it('reads an unclosed quote as plain text', () => {
    expect(parseSkillFrontmatter('---\nname: "open\n  still\n---\n').name).toBe(
      '"open still',
    );
  });

  it('keeps a # that does not start a comment', () => {
    expect(
      parseSkillFrontmatter('---\nname: c#-skill\ndescription: "a # b"\n---\n'),
    ).toEqual({ name: 'c#-skill', description: 'a # b' });
  });

  it.each([
    [
      'plain multiline',
      'description: First part\n  continues here\n\n  new line # note\nmetadata: {}',
      'First part continues here\nnew line',
    ],
    [
      'plain, starting on the next line',
      'description:\n  Starts below\n  and goes on',
      'Starts below and goes on',
    ],
    [
      'double-quoted multiline',
      'description: "Say \\"one\\"\n  two\n\n  three"',
      'Say "one" two\nthree',
    ],
    [
      'single-quoted multiline',
      "description: 'It''s\n  here' # c",
      "It's here",
    ],
    [
      'folded block with paragraphs, more-indented lines and a header comment',
      'description: >- # note\n  a\n  b\n\n  c\n    code\n  d',
      'a b\nc\n  code\nd',
    ],
    [
      'literal block keeping relative indentation',
      'description: |2\n  a\n    b',
      'a\n  b',
    ],
  ])('reads a %s description', (_label, fm, description) => {
    expect(
      parseSkillFrontmatter(`---\nname: a-skill\n${fm}\n---\n`).description,
    ).toBe(description);
  });

  it('counts every line of a long plain multiline description', () => {
    const words = Array.from(
      { length: 4 },
      (_, i) => `${'w'.repeat(44)}${String(i)}`,
    );
    const { description } = parseSkillFrontmatter(
      `---\nname: x\ndescription: ${words.join('\n  ')}\n---\n`,
    );
    expect(description).toBe(words.join(' '));
    expect(Buffer.byteLength(description ?? '')).toBe(183);
  });

  it('handles a BOM and CRLF line ends', () => {
    expect(
      parseSkillFrontmatter('\uFEFF---\r\nname: x\r\n---\r\nbody'),
    ).toEqual({ name: 'x' });
  });

  it.each([
    ['no frontmatter', '# Just a heading\nname: nope'],
    ['an unterminated block', '---\nname: x\n'],
    ['empty values', '---\nname:\ndescription: ""\n---\n'],
  ])('returns nothing for %s', (_label, text) => {
    expect(parseSkillFrontmatter(text)).toEqual({});
  });
});
