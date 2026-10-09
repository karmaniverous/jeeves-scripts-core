/**
 * Root ESLint flat config for the jeeves-scripts-core monorepo.
 *
 * Applies strict, type-aware linting (`strictTypeChecked` +
 * `stylisticTypeChecked`) to every TypeScript file in the repo, including
 * config files, scripts and tests in every workspace. No file is excluded
 * from type-aware linting and no `eslint-disable` is permitted anywhere in
 * the repo (Decision 22).
 *
 * Exception (Decision 32): code copied wholesale from jeeves-scripts-template
 * and not yet refactored is listed in `packages/core/legacy.json`. Those
 * paths get the template's own rule set (`strictTypeChecked`, without
 * `stylisticTypeChecked` or TSDoc checks), type-aware against
 * `packages/core/tsconfig.legacy.json`. The list is shrink-only.
 *
 * @module eslint.config
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import eslint from '@eslint/js';
import vitestPlugin from '@vitest/eslint-plugin';
import type { ESLint, Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import tsdocPlugin from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

import legacy from './packages/core/legacy.json' with { type: 'json' };

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

/** Decision 32 legacy paths, relative to the repo root. */
const legacyFiles = legacy.paths.map((p) => `packages/core/${p}`);

const strictTypeCheckedRules = (
  tseslint.configs.strictTypeChecked as unknown as unknown[]
).reduce<Record<string, unknown>>((acc, cfg) => {
  const rules = (cfg as { rules?: Record<string, unknown> }).rules;
  if (rules) Object.assign(acc, rules);
  return acc;
}, {});

// Extract strict + stylistic type-checked rules into one rules object.
const typeCheckedConfigs = [
  ...(tseslint.configs.strictTypeChecked as unknown as unknown[]),
  ...(tseslint.configs.stylisticTypeChecked as unknown as unknown[]),
];
const typeCheckedRules = typeCheckedConfigs.reduce<Record<string, unknown>>(
  (acc, cfg) => {
    const rules = (cfg as { rules?: Record<string, unknown> }).rules;
    if (rules) Object.assign(acc, rules);
    return acc;
  },
  {},
);

// Cast the Vitest plugin to ESLint's Plugin type to satisfy TS.
const vitest = vitestPlugin as unknown as ESLint.Plugin;

// Vitest recommended rules (flat config).
const vitestRecommendedRules: Linter.RulesRecord =
  (
    vitestPlugin as unknown as {
      configs?: { recommended?: { rules?: Linter.RulesRecord } };
    }
  ).configs?.recommended?.rules ?? {};

export default [
  {
    ignores: [
      '**/.rollup.cache/**/*',
      '**/assets/**/*',
      '**/coverage/**/*',
      '**/diagrams/out/**/*',
      '**/dist/**',
      '**/docs/**/*',
      '**/template/**/*',
      'node_modules/**/*',
      '**/node_modules/**/*',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'readonly',
        require: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: legacyFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettierPlugin,
      'simple-import-sort': simpleImportSortPlugin,
      tsdoc: tsdocPlugin,
    },
    rules: {
      ...typeCheckedRules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'tsdoc/syntax': 'warn',
      'prettier/prettier': 'error',
    },
  },
  {
    // Decision 32: the template's rule set for not-yet-refactored code.
    files: legacyFiles.map((p) => `${p}.{ts,tsx}`),
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./packages/core/tsconfig.legacy.json'],
        tsconfigRootDir,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettierPlugin,
      'simple-import-sort': simpleImportSortPlugin,
    },
    rules: {
      ...strictTypeCheckedRules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'prettier/prettier': 'error',
    },
  },
  {
    // Decision 32: vitest rules for legacy tests, against the legacy project.
    files: legacyFiles.map((p) => `${p}.test.{ts,tsx}`),
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./packages/core/tsconfig.legacy.json'],
        tsconfigRootDir,
      },
    },
    plugins: {
      vitest,
    },
    rules: {
      ...vitestRecommendedRules,
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    ignores: legacyFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: {
      vitest,
    },
    rules: {
      ...vitestRecommendedRules,
      'prettier/prettier': 'error',
    },
  },
  prettierConfig,
];
