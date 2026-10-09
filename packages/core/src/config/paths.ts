/**
 * @module config/paths
 *
 * Typed getters over `jeeves-scripts.json`'s `instance` and `paths`
 * blocks — core's constants module reborn as a function of the loaded
 * config (Decision 3: `paths().contentDir` instead of importing
 * `CONTENT_DIR`). Derives every path from `instance.baseDir` unless
 * `paths` or an honoured environment variable overrides it.
 */

import path from 'node:path';

import { loadConfig, type LoadConfigOptions } from './loader.js';
import type { Config } from './schema.js';

/** Every path core resolves from `instance.baseDir` and `paths`. */
export interface ResolvedPaths {
  /** `instance.baseDir`. */
  baseDir: string;
  /** Config directory. */
  configDir: string;
  /** Content directory (the default silo unless `siloRouting.defaultBasePath` is set). */
  contentDir: string;
  /** The instance repo. */
  scriptsDir: string;
  /** Credential files. */
  credentialsDir: string;
  /** Service state. */
  stateDir: string;
  /** IMAP secret files: the `imap` folder under `credentialsDir`. */
  imapSecretsDir: string;
  /** gog home: service-account keys, OAuth client credentials, keyring. */
  gogHome: string;
  /** Token metrics output. */
  tokenMetricsDir: string;
}

/**
 * Derive every path core resolves from a loaded config, honouring the
 * environment overrides that exist today (`GOG_HOME`,
 * `TOKEN_METRICS_DIR`), which win over the file (Architecture → Config
 * Resolution).
 */
export const derivePaths = (config: Config): ResolvedPaths => {
  const baseDir = config.instance.baseDir;
  const configDir = config.paths.configDir ?? path.join(baseDir, 'config');
  const contentDir = config.paths.contentDir ?? path.join(baseDir, 'content');
  const scriptsDir =
    config.paths.scriptsDir ?? path.join(baseDir, 'jeeves-scripts');
  const credentialsDir =
    config.paths.credentialsDir ?? path.join(configDir, 'credentials');
  const stateDir = config.paths.stateDir ?? path.join(baseDir, 'state');
  const imapSecretsDir = path.join(credentialsDir, 'imap');
  const gogHome =
    process.env.GOG_HOME ??
    config.paths.gogHome ??
    path.join(configDir, 'gogcli');
  const tokenMetricsDir =
    process.env.TOKEN_METRICS_DIR ??
    config.paths.tokenMetricsDir ??
    path.join(stateDir, 'jeeves-runner/token-metrics');
  return {
    baseDir,
    configDir,
    contentDir,
    scriptsDir,
    credentialsDir,
    stateDir,
    imapSecretsDir,
    gogHome,
    tokenMetricsDir,
  };
};

/** Resolved paths for the loaded config, loading it on first call. */
export const paths = (options: LoadConfigOptions = {}): ResolvedPaths =>
  derivePaths(loadConfig(options));
