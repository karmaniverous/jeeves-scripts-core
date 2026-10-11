/**
 * @module build-registry
 *
 * Build a JSON registry of all accessible GitHub repos.
 *
 * Called by the jeeves-runner scheduler. Authenticates via the gh binary,
 * paginates the /user/repos endpoint to collect repos with push
 * access, and writes the registry file under the GitHub
 * archive directory.
 */

import fs from 'node:fs';

import { ensureDir } from '@karmaniverous/jeeves';

import { defineJob } from '../jobs/define-job.js';
import {
  ghApiVia,
  type GitHubJobDeps,
  githubJobDeps,
} from './lib/github-deps.js';

interface GhRepo {
  full_name: string;
  owner: { login: string };
  name: string;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  default_branch: string;
  description: string | null;
  homepage: string | null;
  topics: string[];
  language: string | null;
  license: { spdx_id: string } | null;
  pushed_at: string;
  updated_at: string;
  has_issues: boolean;
  has_wiki: boolean;
  open_issues_count: number;
  visibility: string;
  permissions?: { push?: boolean };
}

function computeSocialPolicy(
  owner: string,
  isPrivate: boolean,
  homeAccount: string,
): { socialUse: string; notes: string } {
  if (!isPrivate) return { socialUse: 'ok', notes: 'public repo' };
  if (homeAccount && owner === homeAccount)
    return {
      socialUse: 'caution',
      notes: `private but in ${homeAccount} scope; discuss before quoting verbatim`,
    };
  return {
    socialUse: 'restricted',
    notes:
      'private repo outside home scope; do not use externally without explicit approval',
  };
}

function getWriteRepos(deps: Pick<GitHubJobDeps, 'gh'>): GhRepo[] {
  const out: GhRepo[] = [];
  let page = 1;
  for (;;) {
    const endpoint = `/user/repos?per_page=100&page=${String(page)}&affiliation=owner,collaborator,organization_member`;
    const rawRepos = ghApiVia(deps, endpoint);
    const repos = rawRepos as GhRepo[];
    if (!Array.isArray(rawRepos) || repos.length === 0) break;
    for (const r of repos) {
      if (r.permissions?.push === true) out.push(r);
    }
    if (repos.length < 100) break;
    page++;
  }
  return out;
}

/**
 * Fetch all visible repos for an org (including read-only).
 * Used for external scopes where we observe but don't contribute.
 */
function getOrgRepos(org: string, deps: Pick<GitHubJobDeps, 'gh'>): GhRepo[] {
  const out: GhRepo[] = [];
  let page = 1;
  for (;;) {
    const endpoint = `/orgs/${org}/repos?per_page=100&page=${String(page)}&type=all`;
    const rawRepos = ghApiVia(deps, endpoint);
    const repos = rawRepos as GhRepo[];
    if (!Array.isArray(rawRepos) || repos.length === 0) break;
    out.push(...repos);
    if (repos.length < 100) break;
    page++;
  }
  return out;
}

/** Run the job. */
export function buildRegistry(deps: GitHubJobDeps): void {
  if (!fs.existsSync(deps.configDir)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  ensureDir(deps.githubDir);
  console.log(`[repo-registry] start ${deps.now()}`);

  const account = deps.account;
  if (!account) {
    console.log(
      '[skip] integrations.gh.account is not set in jeeves-scripts.json',
    );
    return;
  }

  deps.run(deps.bin, ['auth', 'switch', '-u', account]);
  const repos = getWriteRepos(deps)
    .filter((r) => !r.archived && !r.disabled && !r.fork)
    .sort(
      (a, b) =>
        new Date(a.pushed_at).getTime() - new Date(b.pushed_at).getTime(),
    );

  let scopes: Record<string, { external: boolean }> = {};
  try {
    const existing = JSON.parse(fs.readFileSync(deps.registryPath, 'utf8')) as {
      scopes?: Record<string, { external: boolean }>;
    };
    if (existing.scopes && typeof existing.scopes === 'object')
      scopes = existing.scopes;
  } catch {
    // No existing registry
  }

  // Fetch repos from external scopes (read-only access is sufficient).
  const externalScopes = Object.entries(scopes)
    .filter(([, v]) => v.external)
    .map(([k]) => k);

  const externalRepos: GhRepo[] = [];
  for (const org of externalScopes) {
    try {
      const orgRepos = getOrgRepos(org, deps).filter(
        (r) => !r.archived && !r.disabled && !r.fork,
      );
      externalRepos.push(...orgRepos);
      console.log(
        `[repo-registry] external scope ${org}: ${String(orgRepos.length)} repos`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(
        `[repo-registry] external scope ${org}: fetch failed (${msg})`,
      );
    }
  }

  // Merge: write-access repos + external repos (deduplicate by full_name).
  const allRepos = [...repos];
  const seen = new Set(repos.map((r) => r.full_name));
  for (const r of externalRepos) {
    if (!seen.has(r.full_name)) {
      allRepos.push(r);
      seen.add(r.full_name);
    }
  }

  const reposObj: Record<string, unknown> = {};
  for (const r of allRepos) {
    const pol = computeSocialPolicy(r.owner.login, r.private, account);
    reposObj[r.full_name] = {
      description: r.description,
      language: r.language,
      topics: r.topics,
      pushedAt: r.pushed_at,
      defaultBranch: r.default_branch,
      isArchived: r.archived,
      isPrivate: r.private,
      stargazers: 0,
      openIssues: r.open_issues_count,
      visibility: r.visibility,
      licenseSpdx: r.license?.spdx_id,
      homepage: r.homepage,
      socialUse: pol.socialUse,
      socialNotes: pol.notes,
    };
  }

  const newRegistry = {
    scopes,
    generatedAt: deps.now(),
    repos: reposObj,
  };

  fs.writeFileSync(
    deps.registryPath,
    JSON.stringify(newRegistry, null, 2) + '\n',
    'utf8',
  );
  console.log(`[repo-registry] wrote ${deps.registryPath}`);

  console.log(
    `[repo-registry] end   ${deps.now()} (count=${String(allRepos.length)}, external=${String(externalRepos.length)})`,
  );
}

export default defineJob({
  id: 'github-build-registry',
  domain: 'github',
  name: 'github/build-registry',
  run: () => {
    buildRegistry(githubJobDeps());
  },
});
