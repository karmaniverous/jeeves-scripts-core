/**
 * Tests for the snapshot layout: unique inventory paths per skill. The
 * index and JSON texts are covered through `writeSnapshot`.
 */

import { describe, expect, it } from 'vitest';

import type { InventorySkill } from './inventory.js';
import { placeInventory } from './snapshot-render.js';

const skill = (
  name: string,
  origin: InventorySkill['origin'],
): InventorySkill => ({
  name,
  description: '',
  origin,
  file: `/${name}/SKILL.md`,
  bytes: 0,
  text: '',
});

const paths = (inventory: InventorySkill[]): string[] =>
  placeInventory(inventory).map((p) => p.snapshotFile);

describe('placeInventory', () => {
  it('suffixes clashing names', () => {
    const alpha = skill('alpha', 'workshop');
    expect(paths([alpha, alpha, skill('my skill', 'local'), alpha])).toEqual([
      'inventory/workshop/alpha.md',
      'inventory/workshop/alpha-2.md',
      'inventory/local/my_skill.md',
      'inventory/workshop/alpha-3.md',
    ]);
  });

  it('never yields an empty file name', () => {
    expect(paths([skill('', 'local')])).toEqual(['inventory/local/_.md']);
  });
});
