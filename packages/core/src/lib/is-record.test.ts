import { describe, expect, it } from 'vitest';

import { isRecord } from './is-record.js';

describe('isRecord', () => {
  it('accepts objects, including arrays, and narrows them for key access', () => {
    const value: unknown = JSON.parse('{"a":1}');
    expect(isRecord(value) ? value.a : undefined).toBe(1);
    expect(isRecord([])).toBe(true);
  });

  it('rejects null and every primitive', () => {
    for (const v of [null, undefined, 0, '', 'x', true, Symbol('s'), 1n])
      expect(isRecord(v)).toBe(false);
  });
});
