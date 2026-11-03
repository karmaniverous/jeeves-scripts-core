/**
 * Tests for the pure parts of `skill-review/live`: the global
 * `node_modules` found from the `openclaw` dist, or a warning and none
 * (the inventory then has no bundled or jeeves-tools skills). The live
 * deps are tested through the runnable (`review-skill-proposals.test`).
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { globalModulesDir } from './live.js';

const DIST = '/g/lib/node_modules/openclaw/dist';

describe('globalModulesDir', () => {
  it("is the openclaw package's parent", () => {
    const log = vi.fn();
    expect(globalModulesDir(() => DIST, log)).toBe(
      path.dirname(path.dirname(DIST)),
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('warns and finds none when the openclaw package cannot be resolved', () => {
    const log = vi.fn();
    expect(
      globalModulesDir(() => {
        throw new Error('no npm');
      }, log),
    ).toBeUndefined();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '[warn] admin/review-skill-proposals: no global openclaw package, so no bundled or jeeves-tools skills: no npm',
    );
  });
});
