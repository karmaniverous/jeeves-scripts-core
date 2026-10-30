/**
 * @module cli/init
 *
 * `jeeves-scripts init --config-dir <dir> [--name <pkg>] [--core <version>]`
 * (R28, Decisions 14, 15, 17, 20; design §7; #57): writes an instance
 * repo into the root from the template bundled in core (`template/`), plus
 * its config outside the repo: `jeeves-scripts.json` in the repo is a
 * pointer to the config directory, and `<dir>/config.json` is written from
 * the template's `config.sample.json`. It never overwrites a file: every
 * file that exists, the pointer and `config.json` included, is skipped. The renamed dotfiles (`gitignore`,
 * `npmrc`, `nvmrc`) are restored, and `package.json` gets the package name
 * (default: the target folder's name, Decision 53) and core pinned at an
 * exact version (default: the running core's).
 *
 * Reads the bundled template; writes files under the root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import {
  CONFIG_FILE_NAME,
  type Pointer,
  pointerSchema,
} from '../config/pointer.js';
import { EXACT_SEMVER } from '../runnables/plugin.js';
import { CORE_PACKAGE, corePackageDir, coreVersion } from './package-info.js';

/** Template files stored under another name, so npm packs them (top level only). */
export const RENAMED_DOTFILES: Readonly<Record<string, string>> = {
  gitignore: '.gitignore',
  npmrc: '.npmrc',
  nvmrc: '.nvmrc',
};

/** The template's sample config: written to `<config dir>/config.json`, not the repo. */
export const CONFIG_SAMPLE = 'config.sample.json';

/** The instance repo's config pointer. */
const POINTER_FILE = 'jeeves-scripts.json';

/** Where an instance's `$schema` references live, under its `node_modules`. */
const SCHEMA_DIR = 'node_modules/@karmaniverous/jeeves-scripts-core/schema';

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
  /**
   * The config directory (`--config-dir`, required): `config.json` is
   * written there and the repo's `jeeves-scripts.json` points at it.
   * Relative paths resolve against the working directory.
   */
  configDir: string;
  /** Package name. Default: the name of the folder `init` writes into. */
  name?: string;
  /** Exact core version to pin. Default: the running core's. */
  core?: string;
  /** The template to copy. Default: core's bundled `template/`. */
  templateDir?: string;
}

/**
 * What {@link initRepo} did: root-relative POSIX paths, and the config file
 * by its absolute path.
 */
export interface InitResult {
  /** Files written. */
  created: string[];
  /** Files that existed and were left alone. */
  skipped: string[];
}

/**
 * A `$schema` reference from a file in `from` to `to`: the POSIX relative
 * path (`./` or `../`), or a `file:` URL when no relative path exists (the
 * two are on different Windows drives; #62 review).
 */
export const schemaRef = (
  from: string,
  to: string,
  paths: typeof path = path,
): string => {
  const rel = paths.relative(from, to);
  if (paths.isAbsolute(rel))
    return pathToFileURL(to, { windows: paths === path.win32 }).href;
  const posix = rel.split(paths.sep).join('/');
  return posix.startsWith('.') ? posix : `./${posix}`;
};

/** Whether `file` exists and is not a config pointer (a legacy full config). */
const isLegacyRepoConfig = (file: string): boolean => {
  if (!fs.existsSync(file)) return false;
  try {
    return !pointerSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
      .success;
  } catch {
    return true;
  }
};

/** The sample config, its `$schema` re-pointed from the config directory. */
const sampleConfig = (
  text: string,
  root: string,
  configDir: string,
): string => {
  const config = z.looseObject({}).parse(JSON.parse(text));
  config.$schema = schemaRef(
    configDir,
    path.join(root, SCHEMA_DIR, 'jeeves-scripts.schema.json'),
  );
  return `${JSON.stringify(config, null, 2)}\n`;
};

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
 * Write the instance repo into `root` and its config into
 * `options.configDir`.
 *
 * @throws When `--config-dir`, `--name` or `--core` is invalid, or the
 *   template is missing.
 */
export const initRepo = (root: string, options: InitOptions): InitResult => {
  if (!options.configDir)
    throw new Error('the config directory (--config-dir <dir>) is required');
  const configDir = path.resolve(options.configDir);
  const fromRoot = path.relative(path.resolve(root), configDir);
  if (!fromRoot.startsWith('..') && !path.isAbsolute(fromRoot))
    throw new Error(
      `the config directory (--config-dir ${configDir}) must be outside the instance repo`,
    );
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
  const files = templateFiles(templateDir);
  if (!files.includes(CONFIG_SAMPLE))
    throw new Error(`The template at ${templateDir} has no ${CONFIG_SAMPLE}.`);
  for (const rel of files) {
    if (rel === CONFIG_SAMPLE || rel === POINTER_FILE) continue;
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

  const configFile = path.join(configDir, CONFIG_FILE_NAME);
  const pointerFile = path.join(root, POINTER_FILE);
  // A repo that already keeps its full config in jeeves-scripts.json (legacy)
  // gets no unused sample config (#62 review); move it with the runbook.
  if (fs.existsSync(configFile) || isLegacyRepoConfig(pointerFile))
    result.skipped.push(configFile);
  else {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      configFile,
      sampleConfig(
        fs.readFileSync(path.join(templateDir, CONFIG_SAMPLE), 'utf8'),
        root,
        configDir,
      ),
    );
    result.created.push(configFile);
  }

  if (fs.existsSync(pointerFile)) result.skipped.push(POINTER_FILE);
  else {
    const pointer: Pointer = {
      $schema: `./${SCHEMA_DIR}/pointer.schema.json`,
      config: configDir,
    };
    fs.writeFileSync(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`);
    result.created.push(POINTER_FILE);
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
