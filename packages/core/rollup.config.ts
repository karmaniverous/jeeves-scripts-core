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
 * Rollup's own `--configPlugin` step (which transpiles this file before
 * running it) still creates a `.rollup.cache/` under `packages/core` via
 * its own internal, unconfigurable plugin instance; that directory
 * (containing absolute host temp paths) is therefore still possible and is
 * excluded from version control by `.gitignore`, never committed.
 */

import { readFileSync } from 'node:fs';
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

/** Suppress circular-dependency warnings from node_modules (third-party). */
function onwarn(warning: RollupLog, defaultHandler: (w: RollupLog) => void) {
  if (
    warning.code === 'CIRCULAR_DEPENDENCY' &&
    warning.ids?.every((id) => id.includes('node_modules'))
  )
    return;
  defaultHandler(warning);
}

const config: RollupOptions = {
  input: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
    bin: 'src/cli/bin.ts',
  },
  external: [
    ...dependencyExternals,
    ...dependencyExternals.map((dep) => new RegExp('^' + dep + '/')),
    /^node:/,
  ],
  onwarn,
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    banner: (chunk) => (chunk.name === 'bin' ? '#!/usr/bin/env node' : ''),
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
