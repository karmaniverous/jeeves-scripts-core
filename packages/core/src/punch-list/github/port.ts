/**
 * @module punch-list/github/port
 *
 * The GitHub facts the status checker reads, behind a
 * small port so derivation stays pure and testable. The live adapter uses
 * core's `gh` wrapper (the instance's gh auth), REST for milestones,
 * issues, releases and comparisons, and GraphQL for an issue's closing PRs.
 *
 * Lists are read with `per_page=100` and no further pages: a milestone
 * with over 100 issues, or a release older than the newest 100, is out of
 * scope for this instance.
 */

import { z } from 'zod';

import { gh } from '../../lib/gh.js';

export const issueSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  state_reason: z.string().nullable().optional(),
  pull_request: z.unknown().optional(),
});
export type Issue = z.infer<typeof issueSchema>;

export const closingPrSchema = z.object({
  number: z.number(),
  url: z.string(),
  merged: z.boolean(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
});
export type ClosingPr = z.infer<typeof closingPrSchema>;

export const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
});
export type Release = z.infer<typeof releaseSchema>;

/** What the status checker asks GitHub. */
export interface GitHubPort {
  /** Issues (not PRs) in the milestone titled `title`; `undefined` when the repo has no such milestone. */
  milestoneIssues: (repo: string, title: string) => Issue[] | undefined;
  /** PRs that close an issue. */
  closingPrs: (repo: string, issue: number) => ClosingPr[];
  /** Published, non-draft, non-prerelease releases, oldest first. */
  releases: (repo: string) => Release[];
  /** Whether `tag` contains commit `sha`. */
  tagContains: (repo: string, tag: string, sha: string) => boolean;
}

const api = (endpoint: string): unknown =>
  JSON.parse(gh(['api', endpoint]).out);

const milestoneSchema = z.object({ number: z.number(), title: z.string() });

const closingQuery = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number url merged mergeCommit{oid}}}}}}`;

const closingResponse = z.object({
  data: z.object({
    repository: z.object({
      issue: z.object({
        closedByPullRequestsReferences: z.object({
          nodes: z.array(closingPrSchema),
        }),
      }),
    }),
  }),
});

/** The live adapter: one instance per run caches each repo's milestones and releases. */
export const liveGitHub = (): GitHubPort => {
  const milestones = new Map<string, z.infer<typeof milestoneSchema>[]>();
  const releases = new Map<string, Release[]>();
  return {
    milestoneIssues: (repo, title) => {
      if (!milestones.has(repo)) {
        milestones.set(
          repo,
          z
            .array(milestoneSchema)
            .parse(api(`repos/${repo}/milestones?state=all&per_page=100`)),
        );
      }
      const m = milestones.get(repo)?.find((x) => x.title === title);
      if (!m) return undefined;
      return z
        .array(issueSchema)
        .parse(
          api(
            `repos/${repo}/issues?milestone=${String(m.number)}&state=all&per_page=100`,
          ),
        )
        .filter((i) => i.pull_request === undefined);
    },
    closingPrs: (repo, issue) => {
      const slash = repo.indexOf('/');
      const owner = repo.slice(0, slash);
      const name = repo.slice(slash + 1);
      const out = gh([
        'api',
        'graphql',
        '-f',
        `query=${closingQuery}`,
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${String(issue)}`,
      ]).out;
      return closingResponse.parse(JSON.parse(out)).data.repository.issue
        .closedByPullRequestsReferences.nodes;
    },
    releases: (repo) => {
      if (!releases.has(repo)) {
        const all = z
          .array(releaseSchema)
          .parse(api(`repos/${repo}/releases?per_page=100`));
        releases.set(
          repo,
          all
            .filter((r) => !r.draft && !r.prerelease && r.published_at)
            .sort((a, b) =>
              (a.published_at ?? '').localeCompare(b.published_at ?? ''),
            ),
        );
      }
      return releases.get(repo) ?? [];
    },
    tagContains: (repo, tag, sha) => {
      const r = z
        .object({ status: z.string() })
        .parse(
          api(`repos/${repo}/compare/${encodeURIComponent(tag)}...${sha}`),
        );
      return r.status === 'behind' || r.status === 'identical';
    },
  };
};
