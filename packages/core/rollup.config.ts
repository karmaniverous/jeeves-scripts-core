/**
 * @module rollup.config
 * Rollup configuration for `@karmaniverous/jeeves-scripts-core`.
 * Entry points: `index` (library), `cli` (the `./cli` export the instance
 * launcher imports) and `bin` (the package `bin`, given a shebang banner);
 * ESM output with declarations.
 *
 * Builds against `tsconfig.build.json`, a build-only project scoped to
 * `src/**` with `rootDir` set, instead of the repo-wide `tsconfig.json`
 * (which also includes `scripts/**` and this file). The repo-wide project's
 * files span outside `src/`, so pointing the plugin at it directly either
 * triggers `@rollup/plugin-typescript`'s TS5011 warning ("the common source
 * directory ... rootDir must be set") or, if `rootDir` is passed as a plugin
 * option instead, a parse error on this toolchain/Windows combination.
 * Scoping the build to its own project avoids both.
 *
 * `cacheDir` moves this plugin instance's own on-disk TS-output cache to
 * the repo's hoisted `node_modules/.cache`, outside this package directory.
 *
 * Node loads this file directly (native type stripping, Node 22.18+), so
 * the build passes no `--configPlugin`. A config plugin would be a second,
 * unconfigured `@rollup/plugin-typescript` instance: it warns
 * `outputToFilesystem defaulting to true` and writes `.rollup.cache/` into
 * this package. Keep this file to erasable TypeScript syntax (no enums,
 * namespaces or parameter properties) so type stripping can run it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescriptPlugin from '@rollup/plugin-typescript';
import type { RollupLog, RollupOptions } from 'rollup';

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as PackageJson;

const cacheDir = fileURLToPath(
  new URL(
    '../../node_modules/.cache/rollup-plugin-typescript',
    import.meta.url,
  ),
);

const dependencyExternals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

/**
 * Suppress circular-dependency warnings from node_modules (third-party),
 * and empty-chunk warnings: with every module an entry, type-only modules
 * (e.g. `admin/lib/openclaw-db/types.ts`) legitimately emit no JavaScript.
 */
function onwarn(warning: RollupLog, defaultHandler: (w: RollupLog) => void) {
  if (warning.code === 'EMPTY_BUNDLE') return;
  if (
    warning.code === 'CIRCULAR_DEPENDENCY' &&
    warning.ids?.every((id) => id.includes('node_modules'))
  )
    return;
  defaultHandler(warning);
}

/**
 * Every non-test module under src is an entry (Decision 32): jobs copied from
 * the template are run by path, so each keeps its own output file.
 */
const input = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .map((f) => f.split('\\').join('/'))
  .filter(
    (f) =>
      f.endsWith('.ts') &&
      !f.endsWith('.test.ts') &&
      !f.endsWith('.fixtures.ts') &&
      !f.includes('/__fixtures__/') &&
      !f.includes('/test-support/'),
  )
  .map((f) => `src/${f}`);

const config: RollupOptions = {
  input,
  external: [
    ...dependencyExternals,
    ...dependencyExternals.map((dep) => new RegExp('^' + dep + '/')),
    /^node:/,
  ],
  onwarn,
  output: {
    dir: 'dist',
    format: 'esm',
    preserveModules: true,
    preserveModulesRoot: 'src',
    entryFileNames: '[name].js',
    banner: (chunk) =>
      chunk.facadeModuleId?.endsWith('bin.ts') ? '#!/usr/bin/env node' : '',
  },
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescriptPlugin({
      tsconfig: './tsconfig.build.json',
      cacheDir,
      outputToFilesystem: false,
      noEmit: false,
      declaration: true,
      declarationDir: 'dist',
      declarationMap: false,
      incremental: false,
    }),
  ],
};

export default config;
