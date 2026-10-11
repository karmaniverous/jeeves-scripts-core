import { describe, expect, it } from 'vitest';

import { frontmatterBlock } from './frontmatter.js';

describe('frontmatterBlock', () => {
  it('quotes strings and writes numbers and booleans as JSON', () => {
    expect(
      frontmatterBlock([
        ['title', 'a: b # c'],
        ['pages', 3],
        ['resolved', false],
      ]),
    ).toBe('---\ntitle: "a: b # c"\npages: 3\nresolved: false\n---\n\n');
  });

  it('escapes newlines and quotes so each field stays on one line', () => {
    expect(frontmatterBlock([['name', 'x\n"y"']])).toBe(
      '---\nname: "x\\n\\"y\\""\n---\n\n',
    );
  });

  it('skips undefined values and keeps the delimiters when empty', () => {
    expect(frontmatterBlock([['owner', undefined]])).toBe('---\n\n---\n\n');
  });
});
