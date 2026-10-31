/**
 * @module github/lib/file-sync
 *
 * The GitHub side of `github-sync-files` (spec 2.8, #7), through `gh api`:
 * list an owner's non-archived repos (paged, narrowed by `include` /
 * `exclude` globs on `full_name`), ensure a ruleset on a repo, and create
 * or update one file on a repo's default branch through the Contents API,
 * compared byte-for-byte by git blob SHA. With `live` false nothing is written; the
 * would-be change is logged and counted.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import type {
  GithubRuleset,
  GithubSyncOwner,
} from '../../config/github-sync-files-schema.js';
import type { GhResult } from '../../lib/gh.js';
import type { GitHubJobDeps } from './github-deps.js';

type GhDeps = Pick<GitHubJobDeps, 'gh'>;

/** What a failed `gh` call said: its stderr, else its stdout. */
const ghOutput = (r: GhResult): string => r.err || r.out;

const repoSchema = z.looseObject({
  full_name: z.string(),
  archived: z.boolean(),
  default_branch: z.string(),
});

/** A repo to sync. */
export type RepoInfo = z.infer<typeof repoSchema>;

const PAGE_SIZE = 100;

/** Whether `fullName` matches any of `patterns` (case-insensitive, as GitHub names are). */
const matchesAny = (fullName: string, patterns: readonly string[]): boolean =>
  patterns.some((p) =>
    path.posix.matchesGlob(fullName.toLowerCase(), p.toLowerCase()),
  );

/**
 * Every non-archived repo of an owner: the acting account's own repos
 * (`type: 'user'`) or an org's, paged at 100, then narrowed by the owner's
 * `include` (when set, only matches are kept) and `exclude` globs.
 */
export function listOwnerRepos(
  deps: GhDeps,
  owner: GithubSyncOwner,
): RepoInfo[] {
  const endpoint =
    owner.type === 'user'
      ? `/user/repos?per_page=${String(PAGE_SIZE)}&type=owner&sort=updated&direction=desc`
      : `/orgs/${owner.owner}/repos?per_page=${String(PAGE_SIZE)}&sort=updated&direction=desc`;
  const repos: RepoInfo[] = [];
  for (let page = 1; ; page++) {
    const { out } = deps.gh([
      'api',
      '-X',
      'GET',
      `${endpoint}&page=${String(page)}`,
    ]);
    const batch =
      out.length > 0 ? z.array(repoSchema).parse(JSON.parse(out)) : [];
    repos.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const { include, exclude = [] } = owner;
  return repos.filter(
    (r) =>
      !r.archived &&
      (include === undefined || matchesAny(r.full_name, include)) &&
      !matchesAny(r.full_name, exclude),
  );
}

/**
 * Write `payload` as JSON to a file in a fresh temp directory, run `fn`
 * with its path (for `gh api --input`), and always delete the directory.
 */
export function withPayloadFile<T>(
  name: string,
  payload: unknown,
  fn: (file: string) => T,
): T {
  // A private temp dir per call: two runs never race on one payload file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-sync-files-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(payload));
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What happened to a repo's ruleset: `unavailable` when the Rulesets API isn't. */
export type RulesetResult = 'created' | 'present' | 'unavailable' | 'failed';

/**
 * Create `ruleset` on `repo` unless one with its name exists (or the
 * Rulesets API is unavailable there).
 *
 * @returns `created` when it was created (or would be, on a dry run);
 *   `failed` when the create was refused.
 */
export function ensureRuleset(
  deps: GhDeps,
  repo: string,
  ruleset: GithubRuleset,
  live: boolean,
): RulesetResult {
  const result = deps.gh(['api', `/repos/${repo}/rulesets`], {
    allowFail: true,
  });
  if (!result.ok) {
    console.log(`  [ruleset] skip ${repo}: rulesets API unavailable`);
    return 'unavailable';
  }
  const existing = result.out
    ? z.array(z.looseObject({ name: z.string() })).parse(JSON.parse(result.out))
    : [];
  if (existing.some((r) => r.name === ruleset.name)) return 'present';

  if (!live) {
    console.log(`  [ruleset] would create for ${repo}`);
    return 'created';
  }
  const created = withPayloadFile('ruleset.json', ruleset, (file) =>
    deps.gh(['api', `/repos/${repo}/rulesets`, '-X', 'POST', '--input', file], {
      allowFail: true,
    }),
  );
  if (created.ok) {
    console.log(`  [ruleset] created for ${repo}`);
    return 'created';
  }
  console.log(`  [ruleset] failed for ${repo}: ${ghOutput(created)}`);
  return 'failed';
}

/**
 * What happened to one file in one repo. `protected`: the default branch
 * only accepts changes through a pull request (HTTP 409), a deliberate
 * repo setting, so the file can't be written directly; it's logged and
 * counted, not a failure.
 */
export type FileResult =
  'created' | 'updated' | 'skipped' | 'protected' | 'failed';

/** True when GitHub refused a write because the branch requires a pull request. */
const requiresPullRequest = (output: string): boolean =>
  output.includes('HTTP 409') && /pull request/i.test(output);

const contentSchema = z.looseObject({ sha: z.string() });

/**
 * The git blob SHA of `content` (`sha1` of `blob <length>\0<bytes>`), as
 * the Contents API reports a file's `sha`. Comparing it, not the returned
 * `content`, also works for files over 1 MB, whose `content` is empty.
 */
export const gitBlobSha = (content: Buffer): string =>
  createHash('sha1')
    .update(`blob ${String(content.length)}\0`)
    .update(content)
    .digest('hex');

/** True when a failed `gh api` call was a 404 (the file doesn't exist). */
const notFound = (output: string): boolean => output.includes('HTTP 404');

/** A file's content, as the instance authored it, and where it goes. */
export interface FileContent {
  /** Path written in each repo. */
  target: string;
  /** The exact bytes to write. */
  content: Buffer;
}

/**
 * Bring `file.target` on `repo`'s default branch to `file.content`, byte
 * for byte.
 *
 * @throws When the current file can't be read for any reason but a 404
 *   (a 403, a 5xx, a rate limit): writing blind would report a create for
 *   a file that exists.
 */
export function syncFile(
  deps: GhDeps,
  repo: RepoInfo,
  file: FileContent,
  live: boolean,
): FileResult {
  const name = repo.full_name;
  const branch = repo.default_branch;
  const where = `${file.target} in ${name}`;
  const target = file.target.split('/').map(encodeURIComponent).join('/');
  const current = deps.gh(
    [
      'api',
      `/repos/${name}/contents/${target}?ref=${encodeURIComponent(branch)}`,
    ],
    { allowFail: true },
  );

  let existingSha: string | undefined;
  if (current.ok) {
    const found = contentSchema.parse(JSON.parse(current.out));
    if (found.sha === gitBlobSha(file.content)) return 'skipped';
    existingSha = found.sha;
  } else if (!notFound(ghOutput(current)))
    throw new Error(
      `cannot read ${where}: ${ghOutput(current) || 'gh api failed'}`,
    );
  const outcome = existingSha ? 'updated' : 'created';

  if (!live) {
    console.log(`  [file] would ${existingSha ? 'update' : 'create'} ${where}`);
    return outcome;
  }

  const payload = {
    message: `chore: ${existingSha ? 'update' : 'add'} ${file.target}`,
    content: file.content.toString('base64'),
    branch,
    ...(existingSha ? { sha: existingSha } : {}),
  };
  const put = withPayloadFile('contents.json', payload, (input) =>
    deps.gh(
      [
        'api',
        `/repos/${name}/contents/${target}`,
        '-X',
        'PUT',
        '--input',
        input,
      ],
      { allowFail: true },
    ),
  );
  if (put.ok) return outcome;
  const detail = ghOutput(put);
  if (requiresPullRequest(detail)) {
    console.log(
      `  [file] skip ${where}: ${branch} requires a pull request (HTTP 409)`,
    );
    return 'protected';
  }
  console.log(`  [file] failed for ${where}: ${detail}`);
  return 'failed';
}
