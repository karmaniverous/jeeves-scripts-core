import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isWithin } from './path-within.js';

describe('isWithin', () => {
  const root = path.resolve('/base/root');

  it('accepts the root itself and paths under it', () => {
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(root, path.join(root, 'a', 'b'))).toBe(true);
    expect(isWithin(root, path.join(root, '..dotted'))).toBe(true);
  });

  it('refuses the parent, siblings and other roots', () => {
    expect(isWithin(root, path.dirname(root))).toBe(false);
    expect(isWithin(root, path.resolve('/base/rooted'))).toBe(false);
    expect(isWithin(root, path.join(root, '..', 'x'))).toBe(false);
  });
});
