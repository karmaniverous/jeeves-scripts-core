/**
 * @module cli/init
 *
 * `jeeves-scripts init [--name <pkg>] [--core <version>]` (R28, Decisions
 * 14, 15, 17, 20; design §7): writes an instance repo into the root from
 * the template bundled in core (`template/`). It never overwrites a file:
 * every file that exists is skipped. The renamed dotfiles (`gitignore`,
 * `npmrc`, `nvmrc`) are restored, and `package.json` gets the package name
 * and core pinned at an exact version (default: the running core's).
 *
 * Reads the bundled template; writes files under the root.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { CORE_PACKAGE, corePackageDir, coreVersion } from './package-info.js';

/** Template files stored under another name, so npm packs them (top level only). */
export const RENAMED_DOTFILES: Readonly<Record<string, string>> = {
  gitignore: '.gitignore',
  npmrc: '.npmrc',
  nvmrc: '.nvmrc',
};

/** The package name `init` writes when `--name` is not given. */
export const DEFAULT_NAME = 'jeeves-scripts';

/** An exact semver version (no range). */
const exactVersionSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'must be an exact version, e.g. 0.1.0 (no range)',
  );

/** An npm package name. */
const packageNameSchema = z
  .string()
  .regex(
    /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
    'must be a valid npm package name',
  );

const packageJsonSchema = z.looseObject({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

/** Options for {@link initRepo}. */
export interface InitOptions {
  /** Package name. Default: {@link DEFAULT_NAME}. */
  name?: string;
  /** Exact core version to pin. Default: the running core's. */
  core?: string;
  /** The template to copy. Default: core's bundled `template/`. */
  templateDir?: string;
}

/** What {@link initRepo} did, as root-relative POSIX paths. */
export interface InitResult {
  /** Files written. */
  created: string[];
  /** Files that existed and were left alone. */
  skipped: string[];
}

const templateFiles = (dir: string): string[] =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      path
        .relative(dir, path.join(e.parentPath, e.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();

const targetName = (rel: string): string => RENAMED_DOTFILES[rel] ?? rel;

const packageJson = (text: string, name: string, version: string): string => {
  const pkg = packageJsonSchema.parse(JSON.parse(text));
  pkg.name = name;
  pkg.dependencies = { ...pkg.dependencies, [CORE_PACKAGE]: version };
  return `${JSON.stringify(pkg, null, 2)}\n`;
};

/**
 * Write the instance repo into `root`.
 *
 * @throws When `--name` or `--core` is invalid, or the template is missing.
 */
export const initRepo = (
  root: string,
  options: InitOptions = {},
): InitResult => {
  const name = packageNameSchema.parse(options.name ?? DEFAULT_NAME);
  const version = exactVersionSchema.parse(options.core ?? coreVersion());
  const templateDir =
    options.templateDir ?? path.join(corePackageDir(), 'template');
  if (!fs.existsSync(templateDir))
    throw new Error(`No bundled template at ${templateDir}.`);

  const result: InitResult = { created: [], skipped: [] };
  for (const rel of templateFiles(templateDir)) {
    const target = targetName(rel);
    const file = path.join(root, target);
    if (fs.existsSync(file)) {
      result.skipped.push(target);
      continue;
    }
    const source = path.join(templateDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (rel === 'package.json')
      fs.writeFileSync(
        file,
        packageJson(fs.readFileSync(source, 'utf8'), name, version),
      );
    else fs.copyFileSync(source, file);
    result.created.push(target);
  }
  return result;
};

/** The report lines for an {@link InitResult}, with the next steps. */
export const formatInit = (root: string, result: InitResult): string[] => [
  ...result.created.map((f) => `create ${f}`),
  ...result.skipped.map((f) => `skip   ${f} (exists)`),
  `init: ${String(result.created.length)} created, ${String(result.skipped.length)} skipped in ${root}`,
  'Next: npm install, then node bin/jeeves-scripts.js config check and node bin/jeeves-scripts.js doctor.',
];

/** A Zod error as one line per issue, else the error's message. */
export const describeError = (e: unknown): string =>
  e instanceof z.ZodError
    ? z.prettifyError(e)
    : e instanceof Error
      ? e.message
      : String(e);
