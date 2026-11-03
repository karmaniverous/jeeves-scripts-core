/**
 * Tests for the proposal id a post line shows: the first 8 chars (a
 * shorter id whole), lengthened until no other id in the post starts
 * with it.
 */

import { describe, expect, it } from 'vitest';

import { POST_ID_MIN_CHARS, postId } from './slack-post.js';

describe('postId', () => {
  it('starts from 8 chars', () => {
    expect(POST_ID_MIN_CHARS).toBe(8);
  });

  it.each([
    ['a short id whole', 'a-1', ['a-1', 'b-2'], 'a-1'],
    [
      'the first 8 chars of a long one',
      'abcdefghij',
      ['abcdefghij', 'x'],
      'abcdefgh',
    ],
    ['an id alone in the post', 'abcdefghij', ['abcdefghij'], 'abcdefgh'],
    [
      'until no other id shares it',
      'abcdefghij',
      ['abcdefghij', 'abcdefgxyz', 'abcdefghiz'],
      'abcdefghij',
    ],
    [
      'a whole id that starts another',
      'abcdefgh',
      ['abcdefgh', 'abcdefghij'],
      'abcdefgh',
    ],
    [
      'the longer of two such ids',
      'abcdefghij',
      ['abcdefgh', 'abcdefghij'],
      'abcdefghi',
    ],
  ])('shows %s', (_case, id, ids, shown) => {
    expect(postId(id, ids)).toBe(shown);
  });
});
