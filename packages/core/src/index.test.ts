import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('package entry point', () => {
  it('exposes the config API', () => {
    expect(core.loadConfig).toBeTypeOf('function');
    expect(core.paths).toBeTypeOf('function');
    expect(core.siloPath).toBeTypeOf('function');
    expect(core.configSchema).toBeDefined();
  });
});
