/**
 * Vitest preset for jeeves-scripts instance repos (design §2, §7): Node
 * environment, Vitest globals, V8 coverage when run with `--coverage`. An
 * instance's `vitest.config.ts` re-exports it:
 *
 * ```ts
 * export { default } from '@karmaniverous/jeeves-scripts-core/presets/vitest.js';
 * ```
 *
 * @packageDocumentation
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
