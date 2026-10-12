/**
 * Vitest configuration for `@karmaniverous/jeeves-scripts-core`.
 *
 * Runs with coverage (Decision 22) and enforces it per file (design §11):
 * every source file needs 80% lines and 70% branches, or the run fails.
 * Excluded, each for a stated reason (design §11 lists them):
 *
 * - `template/`: the bundled build output, a copy of `packages/template`,
 *   covered by that workspace's tests.
 * - `*.test-helper.ts`, `*.fixtures.ts`: test support, not shipped code.
 * - `src/cli/bin.ts`: the package bin, one statement handing the process
 *   to `cli/hand-off` (tested there) at import.
 * - `src/index.ts`, `src/config/index.ts`: re-export barrels with no
 *   statements of their own (the root export test pins the names).
 * - `src/x/like.ts`, `src/x/repost.ts`: declarative `defineJob` calls with
 *   no statements of their own; their behaviour is `run-x-queue-action`'s,
 *   tested there and through the registry test.
 *
 * @module vitest.config
 */

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      '**/.rollup.cache/**',
      '**/dist/**',
      '**/template/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/template/**',
        '**/*.test.ts',
        '**/*.test-helper.ts',
        '**/*.fixtures.ts',
        'src/cli/bin.ts',
        'src/index.ts',
        'src/config/index.ts',
        'src/x/like.ts',
        'src/x/repost.ts',
      ],
      thresholds: {
        perFile: true,
        lines: 80,
        branches: 70,
      },
    },
    testTimeout: 20_000,
  },
});
