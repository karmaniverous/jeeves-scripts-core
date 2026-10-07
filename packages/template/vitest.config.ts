/**
 * Vitest configuration for `jeeves-scripts-template`.
 *
 * Aliases `@karmaniverous/jeeves-scripts-core` to the core workspace's
 * source so the template is always tested against the core just built from
 * source, never against a stale `dist/` (matches the `jeeves-runner`
 * pattern).
 *
 * @module vitest.config
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@karmaniverous/jeeves-scripts-core': fileURLToPath(
        new URL('../core/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
