import { describe, expect, it } from 'vitest';

import { isAbsoluteDir, pointerSchema } from './pointer.js';

describe('isAbsoluteDir (#62 review)', () => {
  it.each([
    ['J:/config/x', true],
    ['J:\\config\\x', true],
    ['\\\\server\\share\\x', true],
    ['/config/x', false],
    ['J:config', false],
    ['config/x', false],
  ])('on Windows, %s is %s', (dir, expected) => {
    expect(isAbsoluteDir(dir, 'win32')).toBe(expected);
  });

  it.each([
    ['/config/x', true],
    ['J:/config/x', false],
    ['config/x', false],
  ])('on POSIX, %s is %s', (dir, expected) => {
    expect(isAbsoluteDir(dir, 'linux')).toBe(expected);
  });

  it('is what the pointer schema checks on this platform', () => {
    const dir = process.platform === 'win32' ? 'J:/config/x' : '/config/x';
    expect(pointerSchema.safeParse({ config: dir }).success).toBe(true);
    expect(pointerSchema.safeParse({ config: 'config/x' }).success).toBe(false);
  });
});
