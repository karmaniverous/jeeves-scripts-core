/**
 * @module config/integrations
 *
 * Typed getter over `jeeves-scripts.json`'s `integrations` block —
 * today's `constants/integrations.ts` and `constants/trackers.ts` as a
 * function of the loaded config, with the environment overrides that
 * exist today (`QDRANT_API_URL`, `GH_CONFIG_DIR`, `LINEAR_CONFIG_PATH`,
 * `JIRA_BOARD_ID`) honoured and derived defaults applied.
 */

import path from 'node:path';

import { loadConfig, type LoadConfigOptions } from './loader.js';
import { derivePaths } from './paths.js';
import type { Config } from './schema.js';

export interface ResolvedIntegrations {
  gh: { bin: string; configDir: string; account: string; botUser: string };
  qdrant: { apiUrl: string; serviceName: string };
  gateway: { host: string; port: number };
  gog: { bin: string };
  slack: { primaryWorkspace: string };
  notion: { version: string };
  jira: {
    siteUrl: string;
    email: string;
    apiTokenPath: string;
    boardId: number | undefined;
    fieldsFilename: string;
    maxHistory: number;
  };
  linear: { configPath: string; maxHistory: number };
  x: { accounts: Record<string, { silo?: string; relativePath?: string }> };
}

/** Derive resolved integration settings from a loaded config. */
export const deriveIntegrations = (config: Config): ResolvedIntegrations => {
  const resolvedPaths = derivePaths(config);
  const i = config.integrations;
  return {
    gh: {
      bin: i.gh.bin ?? 'gh',
      configDir:
        process.env.GH_CONFIG_DIR ??
        i.gh.configDir ??
        path.join(resolvedPaths.configDir, 'gh-cli'),
      account: i.gh.account ?? '',
      botUser: i.gh.botUser ?? '',
    },
    qdrant: {
      apiUrl:
        process.env.QDRANT_API_URL ??
        i.qdrant.apiUrl ??
        'http://localhost:6333',
      serviceName: i.qdrant.serviceName ?? 'qdrant',
    },
    gateway: {
      host: i.gateway.host ?? '127.0.0.1',
      port: i.gateway.port ?? 18789,
    },
    gog: { bin: i.gog.bin ?? 'gog' },
    slack: { primaryWorkspace: i.slack.primaryWorkspace ?? '' },
    notion: { version: i.notion.version ?? '2025-09-03' },
    jira: {
      siteUrl: i.jira.siteUrl ?? '',
      email: i.jira.email ?? '',
      apiTokenPath:
        i.jira.apiTokenPath ??
        path.join(resolvedPaths.credentialsDir, 'atlassian/acli-token.txt'),
      boardId:
        i.jira.boardId ??
        (process.env.JIRA_BOARD_ID
          ? Number(process.env.JIRA_BOARD_ID)
          : undefined),
      fieldsFilename: i.jira.fieldsFilename ?? '_fields.json',
      maxHistory: i.jira.maxHistory ?? 50,
    },
    linear: {
      configPath:
        process.env.LINEAR_CONFIG_PATH ??
        i.linear.configPath ??
        path.join(resolvedPaths.credentialsDir, 'linear.json'),
      maxHistory: i.linear.maxHistory ?? 50,
    },
    x: { accounts: i.x.accounts },
  };
};

/** Resolved integration settings for the loaded config. */
export const integrations = (
  options: LoadConfigOptions = {},
): ResolvedIntegrations => deriveIntegrations(loadConfig(options));
