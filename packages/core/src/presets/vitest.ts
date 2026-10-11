/**
 * Vitest preset for jeeves-scripts instance repos (design §2, §7): Node
 * environment, Vitest globals, V8 coverage when run with `--coverage`. An
 * instance's `vitest.config.ts` re-exports it:
 *
 * ```ts
 * export { default } from '@karmaniverous/jeeves-scripts-core/presets/vitest.js';
 * ```
 *
 * Authored in TypeScript and shipped compiled, with generated types, as
 * `dist/presets/vitest.js` (Decision 52). `vitest` is the instance's
 * devDependency (Decision 53).
 *
 * @packageDocumentation
 */

import { defineConfig, type ViteUserConfig } from 'vitest/config';

/** The instance's Vitest config. */
const config: ViteUserConfig = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});

export default config;
