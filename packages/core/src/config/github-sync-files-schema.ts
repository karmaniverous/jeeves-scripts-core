/**
 * @module config/github-sync-files-schema
 *
 * Zod schemas for the fields `github-sync-files` reads from its own job
 * delta (`jobs['github-sync-files']`, spec 2.8, #7): the files to keep in
 * sync (`files`), the GitHub owners whose repos get them (`owners`) and the
 * optional ruleset (`ruleset`, the Rulesets API shape, loosely validated).
 * Like `silo` and `extraDirs`, they have no runner effect.
 */

import { z } from 'zod';

import { pathSegments, relativePath } from './relative-path.js';

/** One file to keep in sync: read from `source`, written to `target` in every repo. */
export const githubSyncFileSchema = z.object({
  /**
   * Path of the content to write, relative to the instance repo root
   * (`paths.scriptsDir`): not empty, no leading `/` or `\`, no drive
   * letter, no `..` segment, so nothing outside the repo is ever read.
   */
  source: relativePath('source').refine((s) => pathSegments(s).length > 0, {
    message: 'source must name a file under the instance repo root',
  }),
  /** Path written in each repo (relative to the repo root; no leading `/`). */
  target: z
    .string()
    .min(1)
    .refine((t) => !t.startsWith('/'), {
      message: 'target must not start with /',
    }),
});

/** A GitHub owner whose non-archived repos get the files (and the ruleset). */
export const githubSyncOwnerSchema = z.object({
  /** The user or org login. */
  owner: z.string().min(1),
  /**
   * `user`: the acting account's own repos (`/user/repos`), so `owner`
   * must be the acting account; `org`: the org's repos (`/orgs/<owner>/repos`).
   */
  type: z.enum(['user', 'org']),
  /** Apply the top-level `ruleset` to this owner's repos (default `true`; no effect without one). */
  ruleset: z.boolean().optional(),
  /** Glob patterns against `full_name` (`owner/repo`); when set, only matching repos are synced. */
  include: z.array(z.string().min(1)).optional(),
  /** Glob patterns against `full_name`; matching repos are left out. */
  exclude: z.array(z.string().min(1)).optional(),
});

/** A repository ruleset as GitHub's Rulesets API takes it (other keys pass through). */
export const githubRulesetSchema = z.looseObject({
  /** Ruleset name; a repo with a ruleset of this name already has it. */
  name: z.string().min(1),
  /** What it targets (`branch`, `tag`, ...). */
  target: z.string(),
  /** `active`, `evaluate` or `disabled`. */
  enforcement: z.string(),
  /** The rules, each with its `type`. */
  rules: z.array(
    z.looseObject({
      /** The rule type (`pull_request`, `copilot_code_review`, ...). */
      type: z.string(),
    }),
  ),
});

/** One file to keep in sync. */
export type GithubSyncFile = z.infer<typeof githubSyncFileSchema>;
/** One owner to sync. */
export type GithubSyncOwner = z.infer<typeof githubSyncOwnerSchema>;
/** A repository ruleset. */
export type GithubRuleset = z.infer<typeof githubRulesetSchema>;
