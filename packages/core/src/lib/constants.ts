/**
 * @module lib/constants
 *
 * The template's `constants` barrel, rebuilt for core (Decision 32). The
 * template hard-coded instance values; core reads them from config
 * (Decision 3, Decision 26).
 *
 * - Fixed values (state-store keys, thresholds, entity types) stay plain
 *   exported constants.
 * - Config-derived values keep their template names but live on the object
 *   returned by {@link constants}, which reads config lazily on first call,
 *   so importing a module never needs the config to be loaded yet.
 *
 * Transitional: call sites move to the typed getters (`paths()`,
 * `integrations()`, `siloPath()`) as each domain is refactored, and this
 * module shrinks to the fixed values.
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { integrations } from '../config/integrations.js';
import { getLoadedConfigPath, loadConfig } from '../config/loader.js';
import { paths } from '../config/paths.js';
import { siloPath } from '../config/silo-router.js';
import { gatewayPort, openclawStateDirs } from './openclaw-config.js';

// ========== Fixed values ==========

/** Env var naming the OpenClaw upgrade cutoff for token metrics. */
export const OPENCLAW_UPGRADE_CUTOFF_ENV = 'OPENCLAW_UPGRADE_CUTOFF';
/** Runner state namespace for token metrics. */
export const TOKEN_METRICS_NAMESPACE = 'token-metrics';
/** Token metrics session-file cursor key. */
export const TOKEN_METRICS_CURSOR_KEY = 'cursors';
/** Token metrics OpenClaw DB cursor key. */
export const TOKEN_METRICS_DB_CURSOR_KEY = 'cursors-openclaw-db';
/** Token metrics Claude Code cursor key. */
export const TOKEN_METRICS_CC_CURSOR_KEY = 'cursors-claude-code';
/** Cache-read tokens above which a session is refreshed. */
export const SESSION_REFRESH_CACHE_READ_THRESHOLD = 150_000;
/** Idle minutes after which a session is refreshed. */
export const SESSION_REFRESH_IDLE_MINUTES = 60;

/**
 * Configuration for entity types processed by meta scripts (sweep-duplicates,
 * disable-old-meta): content subdirectory, rejection meta keys, and the age
 * threshold for disabling stale meta. Roots resolve through the silo router.
 */
export interface EntityTypeConfig {
  /** Subdirectory name under each silo base path (e.g. 'meetings'). */
  subdir: string;
  /** Case-insensitive meta key variants that mark an entity for rejection/deletion. */
  rejectionKeys: string[];
  /** Age threshold in days for disable-old-meta (null = never auto-disable). */
  maxAgeDays: number | null;
}

/** Entity types in the meta lifecycle. */
export const ENTITY_TYPES: EntityTypeConfig[] = [
  {
    subdir: 'meetings',
    rejectionKeys: ['nonmeeting', 'non_meeting'],
    maxAgeDays: 7,
  },
  { subdir: 'jira/issue', rejectionKeys: [], maxAgeDays: null },
  { subdir: 'linear/issue', rejectionKeys: [], maxAgeDays: null },
];

// ========== Config-derived values ==========

/** Core's own `spawn-worker` module, next to this one (`.ts` in tests, `.js` built). */
const spawnWorkerPath = (): string => {
  const here = fileURLToPath(import.meta.url);
  return path.join(path.dirname(here), `spawn-worker${path.extname(here)}`);
};

/** Core's shipped rate card seed: `config/` at the package root, two levels above this module (`src/lib/` or `dist/lib/`). */
const tokenRatesSeedPath = (): string =>
  fileURLToPath(new URL('../../config/token-rates.seed.json', import.meta.url));

const derive = () => {
  const config = loadConfig();
  const p = paths();
  const i = integrations();
  const configPath = getLoadedConfigPath() ?? '';
  const tokenMetricsDir = p.tokenMetricsDir;
  return {
    /** `instance.name`. */
    INSTANCE_NAME: config.instance.name,
    /** `instance.baseDir`: the root every default path derives from. */
    JEEVES_BASE_DIR: p.baseDir,
    /** `paths.configDir`. */
    CONFIG_DIR: p.configDir,
    /** `paths.contentDir`. */
    CONTENT_DIR: p.contentDir,
    /** `paths.scriptsDir`: the instance repo. */
    SCRIPTS_DIR: p.scriptsDir,
    /** Pipeline config now lives in the instance config. */
    PIPELINE_CONFIG_PATH: configPath,
    /** Silo routing now lives in the instance config. */
    SILO_ROUTING_CONFIG_PATH: configPath,
    /** `paths.credentialsDir`. */
    CREDENTIALS_DIR: p.credentialsDir,
    /** Qdrant URL (`integrations.qdrant.apiUrl`). */
    QDRANT_API_URL: i.qdrant.apiUrl,
    /** Qdrant service name (`integrations.qdrant.serviceName`). */
    QDRANT_SERVICE_NAME: i.qdrant.serviceName,
    /** The gateway listens on loopback; its port is OpenClaw's own setting. */
    GATEWAY_HOST: '127.0.0.1',
    /** The OpenClaw gateway's port, from `openclaw.json`. */
    GATEWAY_PORT: gatewayPort(),
    /** Core's `spawn-worker` script, run by path to dispatch worker sessions. */
    SPAWN_WORKER_PATH: spawnWorkerPath(),
    /** GitHub CLI binary (`integrations.gh.bin`). */
    GH_BIN: i.gh.bin,
    /** GitHub CLI config directory (`integrations.gh.configDir`). */
    GH_CONFIG_DIR: i.gh.configDir,
    /** GitHub account synced (`integrations.gh.account`). */
    GH_ACCOUNT: i.gh.account,
    /** GitHub bot user (`integrations.gh.botUser`). */
    GH_BOT_USER: i.gh.botUser,
    /** GitHub content directory (`{contentDir}/github`). */
    GITHUB_DIR: path.join(p.contentDir, 'github'),
    /** GitHub repo registry (`{contentDir}/github/registry.json`). */
    GITHUB_REGISTRY_PATH: path.join(p.contentDir, 'github', 'registry.json'),
    /** Email event files (`{stateDir}/runner/email-events`). */
    EMAIL_EVENTS_DIR: path.join(p.stateDir, 'runner', 'email-events'),
    /** IMAP secret files (`{credentialsDir}/imap`). */
    IMAP_SECRETS_DIR: p.imapSecretsDir,
    /** gog binary (`integrations.gog.bin`). */
    GOG_BIN: i.gog.bin,
    /** gog home (`paths.gogHome`). */
    GOG_CONFIG_DIR: p.gogHome,
    /** gog's OAuth client file (`{gogHome}/credentials.json`). */
    GOG_CLIENT_PATH: path.join(p.gogHome, 'credentials.json'),
    /** Meetings content directory (`{contentDir}/meetings`). */
    DEFAULT_MEETINGS_DIR: path.join(p.contentDir, 'meetings'),
    /** Slack archive directory (`{contentDir}/slack`). */
    SLACK_DOMAIN_DIR: path.join(p.contentDir, 'slack'),
    /** `Notion-Version` header (`integrations.notion.version`). */
    NOTION_VERSION: i.notion.version,
    /** Notion API key file (`{credentialsDir}/notion-api-key`). */
    NOTION_API_KEY_PATH: path.join(p.credentialsDir, 'notion-api-key'),
    /** X OAuth token files (`{credentialsDir}/oauth`). */
    X_OAUTH_DIR: path.join(p.credentialsDir, 'oauth'),
    /** Handle → content directory, through each account's silo (Decision 28). */
    X_ACCOUNTS: Object.fromEntries(
      Object.entries(i.x.accounts).map(([handle, account]) => [
        handle,
        siloPath(account.silo, [account.relativePath ?? `x/${handle}`]),
      ]),
    ) as Record<string, string>,
    /** OpenClaw's legacy session transcripts directory. */
    SESSIONS_DIR: path.join(openclawStateDirs()[0], 'agents/main/sessions'),
    /** OpenClaw's agent SQLite database (2026.9+). */
    OPENCLAW_AGENT_DB_PATH: path.join(
      openclawStateDirs()[0],
      'agents/main/agent/openclaw-agent.sqlite',
    ),
    /** First UTC hour on OpenClaw 2026.9+ (`OPENCLAW_UPGRADE_CUTOFF`); no default. */
    OPENCLAW_UPGRADE_CUTOFF:
      process.env[OPENCLAW_UPGRADE_CUTOFF_ENV] ?? undefined,
    /** Token-metrics buckets directory (`paths.tokenMetricsDir`). */
    TOKEN_METRICS_DIR: tokenMetricsDir,
    /** The rate card (`{tokenMetricsDir}/token-rates.json`). */
    TOKEN_RATES_PATH: path.join(tokenMetricsDir, 'token-rates.json'),
    /** Models pending a rate (`{tokenMetricsDir}/token-rates.pending.json`). */
    TOKEN_RATES_PENDING_PATH: path.join(
      tokenMetricsDir,
      'token-rates.pending.json',
    ),
    /** Slack DM name cache (`{tokenMetricsDir}/slack-dm-names.json`). */
    SLACK_DM_NAMES_CACHE_PATH: path.join(
      tokenMetricsDir,
      'slack-dm-names.json',
    ),
    /** The rate card seed core ships (`config/token-rates.seed.json` in the package). */
    TOKEN_RATES_SEED_PATH: tokenRatesSeedPath(),
    /** Claude Code session logs (`~/.claude/projects`). */
    CLAUDE_CODE_PROJECTS_DIR: path.join(os.homedir(), '.claude/projects'),
    /** `integrations.jira.siteUrl`. */
    JIRA_SITE_URL: i.jira.siteUrl,
    /** `integrations.jira.email`. */
    JIRA_EMAIL: i.jira.email,
    /** Jira API token file (`integrations.jira.apiTokenPath`). */
    JIRA_API_TOKEN_PATH: i.jira.apiTokenPath,
    /** Jira field cache file name (`integrations.jira.fieldsFilename`). */
    JIRA_FIELDS_FILENAME: i.jira.fieldsFilename,
    /** `integrations.jira.maxHistory`. */
    JIRA_MAX_HISTORY: i.jira.maxHistory,
    /** Linear credentials file (`integrations.linear.configPath`). */
    LINEAR_CONFIG_PATH: i.linear.configPath,
    /** `integrations.linear.maxHistory`. */
    LINEAR_MAX_HISTORY: i.linear.maxHistory,
  };
};

/** Config-derived values under their template names. */
export type Constants = ReturnType<typeof derive>;

let cache: { config: object; values: Constants } | null = null;

/**
 * Config-derived values under their template names, read from the loaded
 * config and cached until the config is reset.
 */
export const constants = (): Constants => {
  const config = loadConfig();
  if (cache?.config !== config) cache = { config, values: derive() };
  return cache.values;
};
