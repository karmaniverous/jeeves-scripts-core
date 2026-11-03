/**
 * Tests for the live home-directory wiring of `skill-review/skills-status`
 * (the gateway call itself is `lib/gateway-rpc`'s, tested there).
 */

import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { liveHomeDirs } from './skills-status.js';

describe('liveHomeDirs', () => {
  it("includes this process's OS home", () => {
    expect(liveHomeDirs()).toContain(path.resolve(os.homedir()));
  });
});
