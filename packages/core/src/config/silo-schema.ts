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

/** A GitHub org routed to a sub-path of its silo. */
export const githubOrgEntrySchema = z.object({
  /** GitHub org name. */
  githubOrg: z.string(),
  /** Path inside the silo the org's repos land under. */
  relativePath: z.string(),
});

/** A GitHub org: a plain name (silo root) or an org with a sub-path. */
export const githubOrgSpecSchema = z.union([z.string(), githubOrgEntrySchema]);

/** One named data silo: where its content lives and what routes to it. */
export const siloSchema = z.object({
  /** Silo root directory. */
  basePath: z.string(),
  /** Email domains whose mail and meetings route here. */
  emailDomains: z.array(z.string()).optional(),
  /** GitHub orgs whose repos route here. */
  githubOrgs: z.array(githubOrgSpecSchema).optional(),
  /** Slack team ids whose messages route here. */
  slackWorkspaces: z.array(z.string()).optional(),
  /** Jira content routes here. */
  jira: z.boolean().optional(),
  /** Linear content routes here. */
  linear: z.boolean().optional(),
});

/** The `siloRouting` block. */
export const siloRoutingSchema = z.object({
  /** Default silo base path. Default: `paths().contentDir` (Decision 28). */
  defaultBasePath: z.string().optional(),
  /** Named silos. */
  silos: z.record(z.string(), siloSchema).default({}),
});

/** Parsed GitHub org entry with a sub-path. */
export type GitHubOrgEntry = z.infer<typeof githubOrgEntrySchema>;
/** Parsed GitHub org spec. */
export type GitHubOrgSpec = z.infer<typeof githubOrgSpecSchema>;
/** Parsed silo. */
export type SiloConfig = z.infer<typeof siloSchema>;
/** Parsed `siloRouting` block. */
export type SiloRoutingConfig = z.infer<typeof siloRoutingSchema>;
