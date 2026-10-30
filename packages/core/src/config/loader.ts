/**
 * @module config/loader
 *
 * Resolves and loads `jeeves-scripts.json` (design §5). The caller (the CLI launcher, or a test) passes the
 * instance repo root explicitly; resolution never depends on the working
 * directory. `--config` / `JEEVES_SCRIPTS_CONFIG` replace the file
 * location only. The loader is lazy and cached with a reset, matching
 * the template's `pipeline-config.ts` / `silo-router.ts` pattern.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { pointedConfigPath, pointerSchema } from './pointer.js';
import { type Config, configSchema } from './schema.js';

/** Env var that overrides the config file location (design §5). */
export const CONFIG_PATH_ENV = 'JEEVES_SCRIPTS_CONFIG';

/** Where to find `jeeves-scripts.json`. */
export interface LoadConfigOptions {
  /** Instance repo root. Required unless `configPath` is given directly. */
  root?: string;
  /** Explicit config file path, overriding `root` and the env var. */
  configPath?: string;
}

/** Where the config came from (#57). */
export type ConfigSource = 'option' | 'environment' | 'pointer' | 'legacy';

/** A resolved config location. */
export interface ResolvedConfig {
  /** The full config file to load. */
  path: string;
  /**
   * `option` (`configPath`) or `environment` (`JEEVES_SCRIPTS_CONFIG`)
   * naming a full config directly; `pointer` when a `jeeves-scripts.json`
   * pointer named `<config>/config.json`; `legacy` for a full config still
   * in the instance repo.
   */
  source: ConfigSource;
  /** The pointer file, when `source` is `pointer`. */
  pointer?: string;
}

/** The warning printed once per process for a config still in the repo. */
export const LEGACY_CONFIG_WARNING =
  'config is in the instance repo; move it (guides/config.md#moving-the-config)';

let _warnedLegacy = false;

/**
 * Where {@link setConfigRoot} keeps the instance root: an environment
 * variable, because the instance plugin imports its own copy of core (tsx
 * loads it as a separate module instance) and child processes need it too.
 */
export const ROOT_ENV = 'JEEVES_SCRIPTS_ROOT';

/**
 * Register the instance root, so a later `loadConfig()` with no location
 * resolves `{root}/jeeves-scripts.json` (pointer or legacy) when
 * `JEEVES_SCRIPTS_CONFIG` is unset. The launcher (`run`, `doctor`) calls
 * it instead of pinning `JEEVES_SCRIPTS_CONFIG` to the repo file (#57).
 * `undefined` clears it. Not cleared by {@link resetConfig}.
 */
export const setConfigRoot = (root: string | undefined): void => {
  if (root === undefined) Reflect.deleteProperty(process.env, ROOT_ENV);
  else process.env[ROOT_ENV] = root;
};

/** The registered instance root, if any. */
export const getConfigRoot = (): string | undefined => {
  const root = process.env[ROOT_ENV];
  return root === undefined || root === '' ? undefined : root;
};

/** Read a JSON file, naming it in any error. */
const readJson = (file: string): unknown => {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code =
      e instanceof Error && 'code' in e ? String(e.code) : 'read failed';
    throw new Error(`The config could not be read from ${file} (${code}).`, {
      cause: e,
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    throw new Error(`The config at ${file} is not valid JSON.`, {
      cause: e,
    });
  }
};

/**
 * Resolve the config (#57): explicit `configPath` wins, then
 * `JEEVES_SCRIPTS_CONFIG`, then `{root}/jeeves-scripts.json`. A file that
 * is a pointer (`{ "config": "<absolute dir>" }`) resolves to
 * `<config>/config.json`, which must exist. A full config (has
 * `instance`) is used as is; found in the repo, it is `legacy` and
 * {@link LEGACY_CONFIG_WARNING} is printed once per process.
 *
 * @throws When no location is given, the pointed config file is missing,
 *   or the file is neither a pointer nor a full config.
 */
export const resolveConfig = (
  options: LoadConfigOptions = {},
): ResolvedConfig => {
  const { value: _value, ...resolved } = locateConfig(options);
  return resolved;
};

/**
 * {@link resolveConfig}, plus the parsed file when it is the full config
 * itself (so {@link loadConfig} reads it once).
 */
const locateConfig = (
  options: LoadConfigOptions,
): ResolvedConfig & { value?: unknown } => {
  const envPath = process.env[CONFIG_PATH_ENV];
  const root = options.root ?? getConfigRoot();
  const [file, direct]: [string, ConfigSource | undefined] = options.configPath
    ? [options.configPath, 'option']
    : envPath
      ? [envPath, 'environment']
      : root
        ? [path.join(root, 'jeeves-scripts.json'), undefined]
        : ['', undefined];
  if (!file)
    throw new Error(
      `Cannot resolve the config file location: pass { root } or { configPath }, or set ${CONFIG_PATH_ENV}.`,
    );
  const value = readJson(file);
  const pointer = pointerSchema.safeParse(value);
  if (pointer.success) {
    const target = pointedConfigPath(pointer.data);
    if (!fs.existsSync(target))
      throw new Error(
        `${file} points at ${pointer.data.config}, but ${target} does not exist.`,
      );
    return { path: target, source: 'pointer', pointer: file };
  }
  const isFullConfig =
    typeof value === 'object' && value !== null && 'instance' in value;
  if (!isFullConfig) {
    const why =
      typeof value === 'object' && value !== null && 'config' in value
        ? `: ${z.prettifyError(pointer.error)}`
        : '';
    throw new Error(
      `${file} is neither a config pointer ({ "config": "<absolute dir>" }) nor a full config (no "instance")${why}`,
    );
  }
  // A full config at the repo's own jeeves-scripts.json is legacy however it
  // was named (--config, JEEVES_SCRIPTS_CONFIG): warned about, and refused
  // by config set / unset (#62 review).
  const repoFile =
    root === undefined ? undefined : path.resolve(root, 'jeeves-scripts.json');
  if (direct && path.resolve(file) !== repoFile)
    return { path: file, source: direct, value };
  if (!_warnedLegacy) {
    _warnedLegacy = true;
    console.warn(LEGACY_CONFIG_WARNING);
  }
  return { path: file, source: 'legacy', value };
};

/** The full config file path {@link resolveConfig} resolves to. */
export const resolveConfigPath = (options: LoadConfigOptions = {}): string =>
  resolveConfig(options).path;

let _config: Config | null = null;
let _configPath: string | null = null;
let _configSource: ConfigSource | null = null;

/**
 * Load, validate and cache `jeeves-scripts.json`. Subsequent calls
 * (without {@link resetConfig}) return the cached value regardless of
 * `options`.
 *
 * @throws When the file is missing, is not valid JSON, or fails schema
 *   validation (including a literal secret value anywhere in the tree).
 */
export const loadConfig = (options: LoadConfigOptions = {}): Config => {
  if (_config) return _config;
  const { value, ...resolved } = locateConfig(options);
  const configPath = resolved.path;
  const parsed = value ?? readJson(configPath);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `The config at ${configPath} failed validation:\n${issues}`,
    );
  }
  _config = result.data;
  _configPath = configPath;
  _configSource = resolved.source;
  return _config;
};

/** The path the cached config was loaded from, or `null` before a load. */
export const getLoadedConfigPath = (): string | null => _configPath;

/** Where the cached config came from, or `null` before a load. */
export const getLoadedConfigSource = (): ConfigSource | null => _configSource;

/** Reset the cached config (for testing, or to reload after a change). */
export const resetConfig = (): void => {
  _config = null;
  _configPath = null;
  _configSource = null;
  _warnedLegacy = false;
};
