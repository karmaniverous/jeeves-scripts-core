/**
 * @module config/loader
 *
 * Resolves and loads `jeeves-scripts.json` (Architecture → Config
 * Resolution). The caller (the CLI launcher, or a test) passes the
 * instance repo root explicitly; resolution never depends on the working
 * directory. `--config` / `JEEVES_SCRIPTS_CONFIG` replace the file
 * location only. The loader is lazy and cached with a reset, matching
 * today's `pipeline-config.ts` / `silo-router.ts` pattern.
 */

import fs from 'node:fs';
import path from 'node:path';

import { type Config, configSchema } from './schema.js';

/** Env var that overrides the config file location (Architecture). */
export const CONFIG_PATH_ENV = 'JEEVES_SCRIPTS_CONFIG';

export interface LoadConfigOptions {
  /** Instance repo root. Required unless `configPath` is given directly. */
  root?: string;
  /** Explicit config file path, overriding `root` and the env var. */
  configPath?: string;
}

/**
 * Resolve the config file path: explicit `configPath` wins, then
 * `JEEVES_SCRIPTS_CONFIG`, then `{root}/jeeves-scripts.json`.
 */
export const resolveConfigPath = (options: LoadConfigOptions = {}): string => {
  if (options.configPath) return options.configPath;
  const envPath = process.env[CONFIG_PATH_ENV];
  if (envPath) return envPath;
  if (options.root) return path.join(options.root, 'jeeves-scripts.json');
  throw new Error(
    `Cannot resolve the config file location: pass { root } or { configPath }, or set ${CONFIG_PATH_ENV}.`,
  );
};

let _config: Config | null = null;
let _configPath: string | null = null;

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
  const configPath = resolveConfigPath(options);
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    const code =
      e instanceof Error && 'code' in e ? String(e.code) : 'read failed';
    throw new Error(
      `jeeves-scripts.json could not be read from ${configPath} (${code}).`,
      { cause: e },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`jeeves-scripts.json at ${configPath} is not valid JSON.`, {
      cause: e,
    });
  }
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `jeeves-scripts.json at ${configPath} failed validation:\n${issues}`,
    );
  }
  _config = result.data;
  _configPath = configPath;
  return _config;
};

/** The path the cached config was loaded from, or `null` before a load. */
export const getLoadedConfigPath = (): string | null => _configPath;

/** Reset the cached config (for testing, or to reload after a change). */
export const resetConfig = (): void => {
  _config = null;
  _configPath = null;
};
