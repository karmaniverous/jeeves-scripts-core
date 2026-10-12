/**
 * Root Knip configuration for the jeeves-scripts-core monorepo.
 *
 * Each workspace package is analyzed independently (Decision 22: dead-code
 * checks run per workspace).
 *
 * @module knip
 */

import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  rules: {
    binaries: 'off',
    devDependencies: 'off',
    exports: 'off',
    types: 'off',
  },
  workspaces: {
    // TypeDoc finds only JSON and JS configs by itself; `npm run docs` passes
    // the TypeScript one with `--options` (Decision 52).
    '.': { typedoc: { config: ['typedoc.config.ts'] } },
    'packages/core': {
      entry: [
        'scripts/*.ts',
        'src/cli/bin.ts',
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/**/*.test-helper.ts',
        '!src/**/*.fixtures.ts',
      ],
      project: ['**/*.{js,ts}', '!template/**'],
    },
    'packages/template': {
      entry: ['jeeves-scripts.plugin.ts', 'src/**/*.test.ts'],
      project: ['**/*.{js,ts}'],
    },
  },
};

export default config;
