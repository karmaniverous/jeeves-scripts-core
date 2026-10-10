/**
 * @module config/integrations-schema
 *
 * Zod schema for the `integrations` block of `jeeves-scripts.json`:
 * the template's `constants/integrations.ts` and `constants/trackers.ts` plus
 * the Qdrant/gateway/gog settings from `constants/instance.ts`, as
 * instance-settable config (Decision 3). All fields are optional;
 * core derives sensible defaults from `instance.baseDir` and `paths`
 * (see `config/integrations.ts`).
 */

import { z } from 'zod';

/** GitHub CLI (`gh`) settings. */
export const ghIntegrationSchema = z.object({
  /** Path to the `gh` executable. Default: `gh` on `PATH`. */
  bin: z.string().optional(),
  /** `GH_CONFIG_DIR` for `gh` (auth, hosts). Default: `{configDir}/gh-cli`. */
  configDir: z.string().optional(),
  /** GitHub user or org whose repos the github domain syncs. */
  account: z.string().optional(),
  /** GitHub bot user that acts for the instance. */
  botUser: z.string().optional(),
});

/** Qdrant (vector store) settings, used by the health check. */
export const qdrantIntegrationSchema = z.object({
  /**
   * Qdrant HTTP API base URL. Default: the watcher's `vectorStore.url`
   * (`{configDir}/jeeves-watcher/config.json`), else `http://localhost:6333`.
   * Set it only when no watcher config names the Qdrant this instance uses.
   */
  apiUrl: z.string().optional(),
  /** OS service name the health check restarts (case-sensitive on Windows). */
  serviceName: z.string().optional(),
});

/** gog (Google Workspace CLI) settings; its home directory is `paths.gogHome`. */
export const gogIntegrationSchema = z.object({
  /** Path to the `gog` executable. Default: `gog` on `PATH`. */
  bin: z.string().optional(),
});

/** Notion settings. */
export const notionIntegrationSchema = z.object({
  /** `Notion-Version` API header value. */
  version: z.string().optional(),
});

/** Jira settings. The API token lives in a credential file, never here. */
export const jiraIntegrationSchema = z.object({
  /** Jira site base URL. */
  siteUrl: z.string().optional(),
  /** Account email the API token belongs to. */
  email: z.string().optional(),
  /** Path to the file holding the API token. Default: under `credentialsDir`. */
  apiTokenPath: z.string().optional(),
  /** Agile board id the backlog jobs work on. */
  boardId: z.number().int().optional(),
  /** File name of the cached field map at the Jira domain root. */
  fieldsFilename: z.string().optional(),
  /** Maximum history entries kept per Jira entity file. */
  maxHistory: z.number().int().positive().optional(),
});

/** Linear settings. The API key lives in the config file named here. */
export const linearIntegrationSchema = z.object({
  /** Path to the Linear credential file. Default: under `credentialsDir`. */
  configPath: z.string().optional(),
  /** Maximum history entries kept per Linear entity file. */
  maxHistory: z.number().int().positive().optional(),
});

/** One X / Twitter account: where its pipeline output lands (Decision 28). */
export const xAccountSchema = z.object({
  /** Silo the account's content lives in. Default: the default silo. */
  silo: z.string().optional(),
  /** Path inside the silo. Default: `x/<account>`. */
  relativePath: z.string().optional(),
});

/** X / Twitter settings. */
export const xIntegrationSchema = z.object({
  /** Accounts by handle. */
  accounts: z.record(z.string(), xAccountSchema).default({}),
});

/** Default `integrations.x` value. */
export const defaultXIntegration: {
  /** No accounts. */
  accounts: Record<string, XAccountConfig>;
} = {
  accounts: {},
};

/** The `integrations` block: every external tool and service core talks to. */
export const integrationsSchema = z.object({
  /** GitHub CLI. */
  gh: ghIntegrationSchema.default({}),
  /** Qdrant. */
  qdrant: qdrantIntegrationSchema.default({}),
  /** gog. */
  gog: gogIntegrationSchema.default({}),
  /** Notion. */
  notion: notionIntegrationSchema.default({}),
  /** Jira. */
  jira: jiraIntegrationSchema.default({}),
  /** Linear. */
  linear: linearIntegrationSchema.default({}),
  /** X / Twitter. */
  x: xIntegrationSchema.default(defaultXIntegration),
});

/** Parsed `integrations` block. */
export type IntegrationsConfig = z.infer<typeof integrationsSchema>;
/** Parsed `integrations.x.accounts` entry. */
export type XAccountConfig = z.infer<typeof xAccountSchema>;
