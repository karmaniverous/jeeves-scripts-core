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

const derive = () => {
  const config = loadConfig();
  const p = paths();
  const i = integrations();
  const configPath = getLoadedConfigPath() ?? '';
  const tokenMetricsDir = p.tokenMetricsDir;
  return {
    INSTANCE_NAME: config.instance.name,
    JEEVES_BASE_DIR: p.baseDir,
    CONFIG_DIR: p.configDir,
    CONTENT_DIR: p.contentDir,
    SCRIPTS_DIR: p.scriptsDir,
    /** Pipeline config now lives in `jeeves-scripts.json`. */
    PIPELINE_CONFIG_PATH: configPath,
    /** Silo routing now lives in `jeeves-scripts.json`. */
    SILO_ROUTING_CONFIG_PATH: configPath,
    CREDENTIALS_DIR: p.credentialsDir,
    QDRANT_API_URL: i.qdrant.apiUrl,
    QDRANT_SERVICE_NAME: i.qdrant.serviceName,
    GATEWAY_HOST: i.gateway.host,
    GATEWAY_PORT: i.gateway.port,
    SPAWN_WORKER_PATH: spawnWorkerPath(),
    GH_BIN: i.gh.bin,
    GH_CONFIG_DIR: i.gh.configDir,
    GH_ACCOUNT: i.gh.account,
    GH_BOT_USER: i.gh.botUser,
    GITHUB_DIR: path.join(p.contentDir, 'github'),
    GITHUB_REGISTRY_PATH: path.join(p.contentDir, 'github', 'registry.json'),
    EMAIL_EVENTS_DIR: path.join(p.stateDir, 'runner', 'email-events'),
    IMAP_SECRETS_DIR: p.imapSecretsDir,
    GOG_BIN: i.gog.bin,
    GOG_CONFIG_DIR: p.gogHome,
    GOG_CLIENT_PATH: path.join(p.gogHome, 'credentials.json'),
    DEFAULT_MEETINGS_DIR: path.join(p.contentDir, 'meetings'),
    SLACK_DOMAIN_DIR: path.join(p.contentDir, 'slack'),
    PRIMARY_WORKSPACE: i.slack.primaryWorkspace,
    SLACK_WORKSPACE_CACHE_PATH: path.join(
      p.configDir,
      'slack-channel-workspaces.json',
    ),
    NOTION_VERSION: i.notion.version,
    NOTION_API_KEY_PATH: path.join(p.credentialsDir, 'notion-api-key'),
    X_OAUTH_DIR: path.join(p.credentialsDir, 'oauth'),
    /** Handle → content directory, through each account's silo (Decision 28). */
    X_ACCOUNTS: Object.fromEntries(
      Object.entries(i.x.accounts).map(([handle, account]) => [
        handle,
        siloPath(account.silo, [account.relativePath ?? `x/${handle}`]),
      ]),
    ) as Record<string, string>,
    SESSIONS_DIR: path.join(os.homedir(), '.openclaw/agents/main/sessions'),
    OPENCLAW_AGENT_DB_PATH: path.join(
      os.homedir(),
      '.openclaw/agents/main/agent/openclaw-agent.sqlite',
    ),
    OPENCLAW_UPGRADE_CUTOFF:
      process.env[OPENCLAW_UPGRADE_CUTOFF_ENV] ?? undefined,
    TOKEN_METRICS_DIR: tokenMetricsDir,
    TOKEN_RATES_PATH: path.join(tokenMetricsDir, 'token-rates.json'),
    TOKEN_RATES_PENDING_PATH: path.join(
      tokenMetricsDir,
      'token-rates.pending.json',
    ),
    SLACK_DM_NAMES_CACHE_PATH: path.join(
      tokenMetricsDir,
      'slack-dm-names.json',
    ),
    /** Instance data file in the instance repo. */
    SLACK_USERS_PATH: path.join(p.scriptsDir, 'src/slack/lib/users.json'),
    /** Instance data file in the instance repo. */
    TOKEN_RATES_SEED_PATH: path.join(
      p.scriptsDir,
      'config/token-rates.seed.json',
    ),
    CLAUDE_CODE_PROJECTS_DIR: path.join(os.homedir(), '.claude/projects'),
    JIRA_SITE_URL: i.jira.siteUrl,
    JIRA_EMAIL: i.jira.email,
    JIRA_API_TOKEN_PATH: i.jira.apiTokenPath,
    JIRA_FIELDS_FILENAME: i.jira.fieldsFilename,
    JIRA_MAX_HISTORY: i.jira.maxHistory,
    LINEAR_CONFIG_PATH: i.linear.configPath,
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
