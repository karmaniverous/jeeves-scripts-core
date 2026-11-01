/**
 * Tests for reading a home directory's meta: the fields used, content
 * cut to its cap, and anything unusable counted as not seeded.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { META_CONTENT_MAX, metaFile, readMeta } from './meta.js';

const file = metaFile('/home/x');
const reader = (text: string | undefined) => (f: string) =>
  f === file ? text : undefined;

describe('readMeta', () => {
  it('reads steer, content (capped) and generatedAt', () => {
    const long = 'c'.repeat(META_CONTENT_MAX + 10);
    expect(
      readMeta(
        '/home/x',
        reader(
          JSON.stringify({
            _generatedAt: '2026-10-01T00:00:00Z',
            _steer: 'Steer',
            _content: long,
            other: 1,
          }),
        ),
      ),
    ).toEqual({
      file: path.join('/home/x', '.meta', 'meta.json'),
      generatedAt: '2026-10-01T00:00:00Z',
      steer: 'Steer',
      content: 'c'.repeat(META_CONTENT_MAX),
    });
  });

  it('leaves out blank and missing fields', () => {
    expect(
      readMeta('/home/x', reader('{"_steer":"  ","_content":""}')),
    ).toEqual({ file });
  });

  it.each([undefined, 'not json', '[1]', '{"_content":42}'])(
    'counts %s as not seeded',
    (text) => {
      expect(readMeta('/home/x', reader(text))).toBeUndefined();
    },
  );
});
