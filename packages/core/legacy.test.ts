/**
 * Decision 32 guard: the legacy list in `legacy.json` is the single source
 * of truth. `tsconfig.json` must exclude exactly those globs from the strict
 * project and `tsconfig.legacy.json` must include exactly those, so no file
 * escapes type checking and none is checked under the wrong settings.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import legacy from './legacy.json' with { type: 'json' };

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

const globs = (value: unknown, key: 'exclude' | 'include'): string[] => {
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list)
    ? list.filter((g): g is string => typeof g === 'string')
    : [];
};

describe('legacy.json (Decision 32)', () => {
  const expected = [...legacy.paths].sort();

  it('tsconfig.json excludes exactly the legacy globs from the strict project', () => {
    const excluded = globs(readJson('./tsconfig.json'), 'exclude').filter((g) =>
      g.startsWith('src/'),
    );
    expect(excluded.sort()).toEqual(expected);
  });

  it('tsconfig.legacy.json includes exactly the legacy globs', () => {
    expect(globs(readJson('./tsconfig.legacy.json'), 'include').sort()).toEqual(
      expected,
    );
  });
});
