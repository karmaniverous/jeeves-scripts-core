/**
 * ESLint preset for jeeves-scripts instance repos (design §2, §7): strict,
 * type-aware typescript-eslint (`strictTypeChecked` and
 * `stylisticTypeChecked`) over every TypeScript and JavaScript file,
 * Prettier formatting and sorted imports. An instance's
 * `eslint.config.ts` is one call:
 *
 * ```ts
 * import jeevesScripts from '@karmaniverous/jeeves-scripts-core/presets/eslint.js';
 *
 * export default jeevesScripts(import.meta.dirname);
 * ```
 *
 * The tools it loads (`eslint`, `@eslint/js`, `typescript-eslint`,
 * `prettier`, `eslint-plugin-prettier`, `eslint-config-prettier`,
 * `eslint-plugin-simple-import-sort`) are the instance's devDependencies.
 *
 * @packageDocumentation
 */

import process from 'node:process';

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

/**
 * Prettier options, set here so an instance needs no Prettier config file.
 * `endOfLine: 'auto'` keeps whatever line endings git checked out.
 */
const prettierOptions = {
  endOfLine: 'auto',
  proseWrap: 'never',
  singleQuote: true,
};

/**
 * The instance's ESLint flat config.
 *
 * @param rootDir - The instance repo root (`import.meta.dirname`
 *   in its `eslint.config.ts`), where its `tsconfig.json` is. Default:
 *   the working directory.
 */
export default function jeevesScriptsEslint(rootDir = process.cwd()) {
  return defineConfig([
    { ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**'] },
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: rootDir },
      },
      plugins: {
        prettier: prettierPlugin,
        'simple-import-sort': simpleImportSort,
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        'prettier/prettier': ['error', prettierOptions],
        'simple-import-sort/exports': 'error',
        'simple-import-sort/imports': 'error',
      },
    },
    prettierConfig,
  ]);
}
