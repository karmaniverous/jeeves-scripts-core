import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { schemaRef } from './init.js';

describe('schemaRef', () => {
  it('refers to the schema by file URL across Windows drives (#62 review)', () => {
    expect(schemaRef('J:\\config\\x', 'D:\\repo\\s.json', path.win32)).toBe(
      'file:///D:/repo/s.json',
    );
    expect(schemaRef('/c/x', '/c/repo/s.json', path.posix)).toBe(
      '../repo/s.json',
    );
    expect(schemaRef('/c', '/c/repo/s.json', path.posix)).toBe('./repo/s.json');
  });
});
