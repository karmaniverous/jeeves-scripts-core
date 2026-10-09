/**
 * @module config/integrations-schema
 *
 * Zod schema for the `integrations` block of `jeeves-scripts.json`:
 * today's `constants/integrations.ts` and `constants/trackers.ts` plus
 * the Qdrant/gateway/gog settings from `constants/instance.ts`, as
 * instance-settable config (Decision 3). All fields are optional;
 * core derives sensible defaults from `instance.baseDir` and `paths`
 * (see `config/paths.ts`).
 */

import { z } from 'zod';

export const ghIntegrationSchema = z.object({
  bin: z.string().optional(),
  configDir: z.string().optional(),
  account: z.string().optional(),
  botUser: z.string().optional(),
});

export const qdrantIntegrationSchema = z.object({
  apiUrl: z.string().optional(),
  serviceName: z.string().optional(),
});

export const gatewayIntegrationSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
});

export const gogIntegrationSchema = z.object({
  bin: z.string().optional(),
});

export const slackIntegrationSchema = z.object({
  primaryWorkspace: z.string().optional(),
});

export const notionIntegrationSchema = z.object({
  version: z.string().optional(),
});

export const jiraIntegrationSchema = z.object({
  siteUrl: z.string().optional(),
  email: z.string().optional(),
  apiTokenPath: z.string().optional(),
  boardId: z.number().int().optional(),
  fieldsFilename: z.string().optional(),
  maxHistory: z.number().int().positive().optional(),
});

export const linearIntegrationSchema = z.object({
  configPath: z.string().optional(),
  maxHistory: z.number().int().positive().optional(),
});

/** One X / Twitter account: which silo its pipeline output lands under. */
export const xAccountSchema = z.object({
  silo: z.string().optional(),
  relativePath: z.string().optional(),
});

export const xIntegrationSchema = z.object({
  accounts: z.record(z.string(), xAccountSchema).default({}),
});
export const defaultXIntegration = { accounts: {} };

export const integrationsSchema = z.object({
  gh: ghIntegrationSchema.default({}),
  qdrant: qdrantIntegrationSchema.default({}),
  gateway: gatewayIntegrationSchema.default({}),
  gog: gogIntegrationSchema.default({}),
  slack: slackIntegrationSchema.default({}),
  notion: notionIntegrationSchema.default({}),
  jira: jiraIntegrationSchema.default({}),
  linear: linearIntegrationSchema.default({}),
  x: xIntegrationSchema.default(defaultXIntegration),
});

export type IntegrationsConfig = z.infer<typeof integrationsSchema>;
export type XAccountConfig = z.infer<typeof xAccountSchema>;
