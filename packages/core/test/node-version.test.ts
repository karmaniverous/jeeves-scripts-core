/**
 * The Node pins must agree with the `engines` floor. The root `.nvmrc` is
 * what nvm picks in this repo; `packages/template/nvmrc` ships in the
 * package and becomes every new instance repo's `.nvmrc` (`init`). Both
 * stayed at 22 when the floor moved to 24.22.2, so `nvm` in the repo
 * selected a Node that npm then rejected (EBADENGINE).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const enginesNode = (rel: string): string => {
  const pkg = JSON.parse(read(rel)) as { engines?: { node?: string } };
  return pkg.engines?.node ?? '';
};

const manifests = [
  'package.json',
  'packages/core/package.json',
  'packages/template/package.json',
];

/** `>=24.22.2` → `24.22.2`; anything else is not a plain floor. */
const floorOf = (range: string): string | undefined =>
  /^>=(\d+\.\d+\.\d+)$/.exec(range)?.[1];

describe('node version pins', () => {
  it('reads a plain >= floor and rejects other ranges', () => {
    expect(floorOf('>=24.22.2')).toBe('24.22.2');
    expect(floorOf('^24.22.2')).toBeUndefined();
  });

  it('every package declares the same plain engines floor', () => {
    const ranges = manifests.map(enginesNode);
    expect(new Set(ranges).size).toBe(1);
    expect(floorOf(ranges[0] ?? '')).toBeDefined();
  });

  it.each(['.nvmrc', 'packages/template/nvmrc'])(
    '%s pins the engines floor',
    (rel) => {
      const floor = floorOf(enginesNode('packages/core/package.json'));
      expect(read(rel).trim()).toBe(floor);
    },
  );
});
