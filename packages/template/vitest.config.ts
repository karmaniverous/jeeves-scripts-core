/**
 * Vitest configuration for `jeeves-scripts-template`.
 *
 * Aliases `@karmaniverous/jeeves-scripts-core` (and its deep imports,
 * `@karmaniverous/jeeves-scripts-core/<path>`) to the core workspace's
 * source so the template is always tested against the core just built from
 * source, never against a stale `dist/` (matches the `jeeves-runner`
 * pattern).
 *
 * @module vitest.config
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const coreSrc = fileURLToPath(new URL('../core/src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@karmaniverous\/jeeves-scripts-core$/,
        replacement: `${coreSrc}index.ts`,
      },
      {
        find: /^@karmaniverous\/jeeves-scripts-core\/(.*)$/,
        replacement: `${coreSrc}$1.ts`,
      },
    ],
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
