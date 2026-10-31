/**
 * @module punch-list/github/facts
 *
 * Gather and judge a milestone's facts: every issue titled
 * with the milestone across the scanned repos, how each was closed, and
 * for each completed issue the first release containing its closing PR's
 * merge commit (the merged PR itself for the unversioned scripts repo).
 */

import { STATUS_PREFIX } from '../model/lines.js';
import type { ClosingPr, GitHubPort, Issue, Release } from './port.js';

/** The repo's name without its owner (`jeeves-server` for `karmaniverous/jeeves-server`). */
export const repoName = (repo: string): string =>
  repo.slice(repo.indexOf('/') + 1);

/** Where one issue stands. */
export type IssueOutcome =
  | 'open'
  | 'not-planned'
  | 'released'
  | 'awaiting-release'
  | 'merged-pr'
  | 'no-pr';

export interface IssueFact {
  repo: string;
  issue: Issue;
  outcome: IssueOutcome;
  pr?: ClosingPr;
  release?: Release;
}

export interface MilestoneFacts {
  slug: string;
  /** Whether any scanned repo has the milestone at all. */
  found: boolean;
  issues: IssueFact[];
}

const mergedPr = (prs: ClosingPr[]): ClosingPr | undefined =>
  prs.find((p) => p.merged && p.mergeCommit);

const judge = (
  port: GitHubPort,
  repo: string,
  issue: Issue,
  scriptsRepo: string,
): IssueFact => {
  if (issue.state === 'open') return { repo, issue, outcome: 'open' };
  if (issue.state_reason === 'not_planned')
    return { repo, issue, outcome: 'not-planned' };
  const pr = mergedPr(port.closingPrs(repo, issue.number));
  if (!pr?.mergeCommit) return { repo, issue, outcome: 'no-pr' };
  if (repo === scriptsRepo) return { repo, issue, outcome: 'merged-pr', pr };
  const sha = pr.mergeCommit.oid;
  const release = port
    .releases(repo)
    .find((r) => port.tagContains(repo, r.tag_name, sha));
  return release
    ? { repo, issue, outcome: 'released', pr, release }
    : { repo, issue, outcome: 'awaiting-release', pr };
};

/** Read a milestone's issues across `repos` and judge each. */
export const gatherFacts = (
  port: GitHubPort,
  slug: string,
  repos: string[],
  scriptsRepo: string,
): MilestoneFacts => {
  let found = false;
  const issues: IssueFact[] = [];
  for (const repo of repos) {
    const list = port.milestoneIssues(repo, slug);
    if (list === undefined) continue;
    found = true;
    for (const issue of list)
      issues.push(judge(port, repo, issue, scriptsRepo));
  }
  return { slug, found, issues };
};

/** Outcomes that prove an issue shipped: a release, or a merged scripts PR. */
const SHIPPED: ReadonlySet<IssueOutcome> = new Set(['released', 'merged-pr']);

/**
 * Done: every issue either shipped (released, or merged in the
 * scripts repo) or closed as not planned, and at least one shipped. An
 * issue closed without a merged PR blocks Done until it is linked to one
 * or closed as not planned.
 */
export const isDone = (facts: MilestoneFacts): boolean =>
  facts.issues.every(
    (f) => SHIPPED.has(f.outcome) || f.outcome === 'not-planned',
  ) && facts.issues.some((f) => SHIPPED.has(f.outcome));

const STATE_LABEL: Record<IssueOutcome, string> = {
  open: 'open',
  'not-planned': 'not planned',
  released: 'released',
  'awaiting-release': 'closed, awaiting release',
  'merged-pr': 'merged',
  'no-pr': 'closed (no linked PR)',
};

const issueRef = (f: IssueFact): string =>
  `[${f.repo}#${String(f.issue.number)}](${f.issue.html_url})`;

/** `- Issues: …` with each issue's state. */
export const issuesLine = (facts: MilestoneFacts): string =>
  `${STATUS_PREFIX.issues}${
    facts.issues.length
      ? facts.issues
          .map((f) => `${issueRef(f)} ${STATE_LABEL[f.outcome]}`)
          .join(' · ')
      : facts.found
        ? 'none yet'
        : 'milestone not found'
  }`;

/**
 * What an issue ships, for labels: `jeeves-server service/3.16.0` for a
 * release, `jeeves-scripts-acme PR #7` for a merged scripts PR, with its URL.
 */
export const shipOf = (
  f: IssueFact,
): { label: string; url: string } | undefined => {
  if (f.outcome === 'released' && f.release) {
    return {
      label: `${repoName(f.repo)} ${f.release.tag_name}`,
      url: f.release.html_url,
    };
  }
  if (f.outcome === 'merged-pr' && f.pr) {
    return {
      label: `${repoName(f.repo)} PR #${String(f.pr.number)}`,
      url: f.pr.url,
    };
  }
  return undefined;
};

/** Each release (or merged scripts PR) and the issue it ships, or `none`. */
export const releasesSummary = (facts: MilestoneFacts): string => {
  const parts = facts.issues.flatMap((f) => {
    const ship = shipOf(f);
    return ship ? [`[${ship.label}](${ship.url}) (${issueRef(f)})`] : [];
  });
  return parts.length ? parts.join(' · ') : 'none';
};

/** `- Releases: …` */
export const releasesLine = (facts: MilestoneFacts): string =>
  `${STATUS_PREFIX.releases}${releasesSummary(facts)}`;
