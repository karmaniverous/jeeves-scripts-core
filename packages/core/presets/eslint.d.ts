/**
 * Types for the ESLint preset for jeeves-scripts instance repos
 * (`eslint.js` beside this file).
 *
 * @packageDocumentation
 */

import type { Linter } from 'eslint';

/**
 * The instance's ESLint flat config.
 *
 * @param rootDir - The instance repo root (`import.meta.dirname` in its
 *   `eslint.config.ts`), where its `tsconfig.json` is. Default: the
 *   working directory.
 */
export default function jeevesScriptsEslint(rootDir?: string): Linter.Config[];
