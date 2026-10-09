/**
 * @module config/silo-schema
 *
 * Zod schema for the `siloRouting` block of `jeeves-scripts.json`:
 * multi-tenant data routing by email domain, GitHub org, Slack workspace,
 * Jira and Linear (Decision 3, Decision 19, Decision 28).
 *
 * Ported from `jeeves-scripts-template` `src/lib/silo-router.ts` (template
 * `main` at `322054c`); routing functions moved to
 * `config/silo-router.ts`.
 */

import { z } from 'zod';

export const githubOrgEntrySchema = z.object({
  githubOrg: z.string(),
  relativePath: z.string(),
});

export const githubOrgSpecSchema = z.union([z.string(), githubOrgEntrySchema]);

export const siloSchema = z.object({
  basePath: z.string(),
  emailDomains: z.array(z.string()).optional(),
  githubOrgs: z.array(githubOrgSpecSchema).optional(),
  slackWorkspaces: z.array(z.string()).optional(),
  jira: z.boolean().optional(),
  linear: z.boolean().optional(),
});

export const siloRoutingSchema = z.object({
  /** Default silo base path. Defaults to `paths().contentDir` (Decision 28). */
  defaultBasePath: z.string().optional(),
  silos: z.record(z.string(), siloSchema).default({}),
});

export type GitHubOrgEntry = z.infer<typeof githubOrgEntrySchema>;
export type GitHubOrgSpec = z.infer<typeof githubOrgSpecSchema>;
export type SiloConfig = z.infer<typeof siloSchema>;
export type SiloRoutingConfig = z.infer<typeof siloRoutingSchema>;
