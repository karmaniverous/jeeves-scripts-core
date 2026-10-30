import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isEnoent } from './fs-errors.js';

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('did not throw');
};

describe('isEnoent', () => {
  it('is true for a missing file', () => {
    expect(
      isEnoent(
        thrown(() => fs.readFileSync(path.join(os.tmpdir(), 'nope-*-x'))),
      ),
    ).toBe(true);
  });

  it.each([
    ['another fs error', thrown(() => fs.readFileSync(os.tmpdir()))],
    ['a plain Error', new Error('ENOENT')],
    ['a non-Error with code ENOENT', { code: 'ENOENT' }],
  ])('is false for %s', (_name, err) => {
    expect(isEnoent(err)).toBe(false);
  });
});
