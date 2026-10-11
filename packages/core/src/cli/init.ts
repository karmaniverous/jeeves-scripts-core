/**
 * @module cli/init
 *
 * `jeeves-scripts init [--name <pkg>] [--core <version>]` (R28, Decisions
 * 14, 15, 17, 20; design §7): writes an instance repo into the root from
 * the template bundled in core (`template/`). It never overwrites a file:
 * every file that exists is skipped. The renamed dotfiles (`gitignore`,
 * `npmrc`, `nvmrc`) are restored, and `package.json` gets the package name
 * (default: the target folder's name, Decision 53) and core pinned at an
 * exact version (default: the running core's).
 *
 * Reads the bundled template; writes files under the root.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { EXACT_SEMVER } from '../jobs/plugin.js';
import { CORE_PACKAGE, corePackageDir, coreVersion } from './package-info.js';

/** Template files stored under another name, so npm packs them (top level only). */
export const RENAMED_DOTFILES: Readonly<Record<string, string>> = {
  gitignore: '.gitignore',
  npmrc: '.npmrc',
  nvmrc: '.nvmrc',
};

/** An npm package name. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * `value` when it matches `pattern`.
 *
 * @throws Naming the option and the rejected value.
 */
const checked = (value: string, pattern: RegExp, problem: string): string => {
  if (!pattern.test(value)) throw new Error(`${problem}: "${value}"`);
  return value;
};

const packageJsonSchema = z.looseObject({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

/** Options for {@link initRepo}. */
export interface InitOptions {
  /** Package name. Default: the name of the folder `init` writes into. */
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
  const name = checked(
    options.name ?? path.basename(path.resolve(root)),
    PACKAGE_NAME,
    `the package name (--name, default: the folder name) must be a valid npm package name`,
  );
  const version = checked(
    options.core ?? coreVersion(),
    EXACT_SEMVER,
    'the core version (--core) must be an exact version, e.g. 0.1.0 (no range)',
  );
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
