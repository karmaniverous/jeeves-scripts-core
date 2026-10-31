/**
 * Tests for YouTube id parsing: every URL form the prototype accepts, and
 * strings with no id.
 */

import { describe, expect, it } from 'vitest';

import { parseVideoId } from './youtube-id.js';

const ID = 'dQw4w9WgXcQ';

describe('parseVideoId', () => {
  it.each([
    ['a bare id', ID],
    ['a bare id with - and _', 'a-b_c-d_e-f'],
    ['watch?v=', `https://www.youtube.com/watch?v=${ID}`],
    [
      '&v= after other params',
      `https://www.youtube.com/watch?list=PL1&v=${ID}&t=42`,
    ],
    ['youtu.be/', `https://youtu.be/${ID}?si=abc`],
    ['/shorts/', `https://youtube.com/shorts/${ID}`],
    ['/embed/', `https://www.youtube.com/embed/${ID}`],
    ['/live/', `https://www.youtube.com/live/${ID}?feature=share`],
  ])('finds the id in %s', (_, input) => {
    expect(parseVideoId(input)).toBe(
      input === 'a-b_c-d_e-f' ? 'a-b_c-d_e-f' : ID,
    );
  });

  it.each([
    'not a video',
    'dQw4w9WgXc',
    'dQw4w9WgXcQQ',
    'https://www.youtube.com/channel/UC123',
    'https://example.com/watch?x=dQw4w9WgXcQ',
    '',
  ])('finds no id in "%s"', (input) => {
    expect(parseVideoId(input)).toBeUndefined();
  });
});
