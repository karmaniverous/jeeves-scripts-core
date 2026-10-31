/**
 * @module github/sync-files
 *
 * Runnable `github-sync-files` (spec 2.8, #7): keeps the files in
 * `jobs['github-sync-files'].files`, and optionally a ruleset, identical
 * across every non-archived repo of the configured owners, writing as the
 * configured `gh` account (default `integrations.gh.botUser`). Skips
 * before any `gh` call when `files` or `owners` is unset or empty. Dry run
 * unless `--live`. After switching accounts it checks the acting login
 * (`verifyActingAccount`) and writes nothing on a mismatch; it always
 * switches back to the login that was active before. One repo's or
 * owner's failure never stops the rest, but the run then fails and
 * `last-run` (runner state `github-sync-files`) is recorded only on a
 * clean run.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import type {
  GithubRuleset,
  GithubSyncFile,
  GithubSyncOwner,
} from '../config/github-sync-files-schema.js';
import type { JobDelta } from '../config/jobs-schema.js';
import { loadConfig } from '../config/loader.js';
import { paths } from '../config/paths.js';
import { argFlag, type ParsedArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { readSources } from './lib/file-sources.js';
import {
  ensureRuleset,
  type FileContent,
  listOwnerRepos,
  type RepoInfo,
  syncFile,
} from './lib/file-sync.js';
import {
  failuresError,
  newTally,
  summaryLine,
  SYNC_FILES_ID,
  type SyncTally,
  tallyFile,
  tallyRuleset,
} from './lib/file-sync-tally.js';
import {
  actingLogin,
  GhAccountMismatchError,
  ghReady,
  type GitHubJobDeps,
  githubJobDeps,
  verifyActingAccount,
} from './lib/github-deps.js';

const LOG = `[${SYNC_FILES_ID}]`;

/** The line an unconfigured run logs before exiting 0. */
export const SYNC_FILES_SKIP = `[skip] jobs['${SYNC_FILES_ID}'].files/owners is not configured`;

/** What {@link syncAll} syncs, resolved from the job delta. */
export interface SyncFilesSettings {
  /** The files to sync; each `source` is read under `root`. */
  files: readonly GithubSyncFile[];
  /** The owners whose repos get them. */
  owners: readonly GithubSyncOwner[];
  /** The `gh` login to write as (default: `deps.botUser`). */
  account?: string | undefined;
  /** The ruleset to ensure, if any. */
  ruleset?: GithubRuleset | undefined;
  /** Write (`--live`); otherwise only log what would change. */
  live: boolean;
  /** The instance repo root `files[].source` is relative to. */
  root: string;
}

/** What {@link syncAll} calls. */
export type SyncFilesDeps = Pick<
  GitHubJobDeps,
  'gh' | 'botUser' | 'runner' | 'now'
>;

/** Sync one repo into `tally`; a throw is recorded as that repo's failure. */
function syncRepo(
  deps: SyncFilesDeps,
  repo: RepoInfo,
  files: readonly FileContent[],
  ruleset: GithubRuleset | undefined,
  live: boolean,
  tally: SyncTally,
): void {
  const name = repo.full_name;
  try {
    tallyRuleset(
      tally,
      name,
      ruleset && ensureRuleset(deps, name, ruleset, live),
    );
    for (const file of files) {
      const outcome = syncFile(deps, repo, file, live);
      tallyFile(tally, name, file.target, outcome);
      if (outcome === 'created' || outcome === 'updated')
        console.log(`  [file] ${outcome} ${file.target} in ${name}`);
    }
  } catch (e) {
    const message = getErrorMessage(e);
    console.log(`  [repo] failed for ${name}: ${message}`);
    tally.failures.push(`${name}: ${message}`);
  }
}

/** Sync every repo of one owner into `tally`; a failed listing is recorded. */
function syncOwner(
  deps: SyncFilesDeps,
  settings: SyncFilesSettings & { account: string },
  owner: GithubSyncOwner,
  files: readonly FileContent[],
  tally: SyncTally,
): void {
  let repos: RepoInfo[];
  try {
    // `/user/repos` lists the acting account's repos, not another user's.
    if (
      owner.type === 'user' &&
      owner.owner.toLowerCase() !== settings.account.toLowerCase()
    )
      throw new Error(
        `a 'user' owner must be the acting account (${settings.account}): GitHub lists only the authenticated user's own repos (/user/repos); sync another user's repos by acting as that user`,
      );
    repos = listOwnerRepos(deps, owner);
  } catch (e) {
    const message = getErrorMessage(e);
    console.log(`${LOG} ${owner.owner}: listing failed: ${message}`);
    tally.failures.push(`${owner.owner} repo listing: ${message}`);
    return;
  }
  console.log(`${LOG} ${owner.owner}: ${String(repos.length)} repos`);
  const ruleset = owner.ruleset === false ? undefined : settings.ruleset;
  for (const repo of repos)
    syncRepo(deps, repo, files, ruleset, settings.live, tally);
}

/** The login `gh` acts as now; throws when it can't be read. */
function activeLogin(deps: SyncFilesDeps): string {
  try {
    const login = actingLogin(deps);
    if (login) return login;
    throw new Error('empty login');
  } catch (e) {
    throw new Error(
      `${SYNC_FILES_ID}: cannot read the active gh login; not switching: ${getErrorMessage(e)}`,
      { cause: e },
    );
  }
}

/** Switch `gh` back to `login`; a failure is rethrown only when nothing else failed. */
function restoreLogin(
  deps: SyncFilesDeps,
  login: string,
  rethrow: boolean,
): void {
  try {
    deps.gh(['auth', 'switch', '-u', login]);
  } catch (e) {
    console.log(
      `${LOG} could not switch gh back to ${login}: ${getErrorMessage(e)}`,
    );
    if (rethrow) throw e;
  }
}

/**
 * Sync every owner as the account, always switch `gh` back to the login
 * active before the switch, and record `last-run` only when nothing
 * failed and that switch back succeeded.
 *
 * @throws When no account is configured, a source can't be read or
 *   resolves outside `root`, the acting login isn't the account, (after
 *   every repo was attempted) any listing, read or write failed, or the
 *   switch back failed on an otherwise clean run.
 */
export function syncAll(
  settings: SyncFilesSettings,
  deps: SyncFilesDeps,
): void {
  const account = settings.account ?? deps.botUser;
  if (!account)
    throw new Error(
      `${SYNC_FILES_ID}: no account to act as; set jobs['${SYNC_FILES_ID}'].account or integrations.gh.botUser`,
    );
  const files = readSources(settings.files, settings.root);
  if (!settings.live) console.log(`${LOG} DRY RUN: pass --live to write`);
  const original = activeLogin(deps);
  const client = deps.runner();
  let clean = false;
  try {
    deps.gh(['auth', 'switch', '-u', account]);
    try {
      verifyActingAccount(deps, account);
    } catch (e) {
      if (!(e instanceof GhAccountMismatchError)) throw e;
      throw new GhAccountMismatchError(
        `${SYNC_FILES_ID}: ${e.message}; not writing to any repo`,
        { cause: e },
      );
    }
    const tally = newTally();
    for (const owner of settings.owners)
      syncOwner(deps, { ...settings, account }, owner, files, tally);
    console.log(summaryLine(tally));
    if (tally.failures.length > 0) throw failuresError(tally);
    clean = true;
  } finally {
    try {
      restoreLogin(deps, original, clean);
      if (clean) client.setState(SYNC_FILES_ID, 'last-run', deps.now());
    } finally {
      client.close();
    }
  }
}

/** The flags `github-sync-files` accepts. */
export const syncFilesFlags = {
  live: argFlag('--live', 'Write files and rulesets (default: dry run)'),
};

/**
 * Run the job from its delta: skip when `files` or `owners` is unset or
 * empty (before any `gh` call), or when the gh config dir is missing.
 */
export function syncFiles(
  flags: Partial<ParsedArgs<typeof syncFilesFlags>>,
  delta: JobDelta | undefined = loadConfig().jobs[SYNC_FILES_ID],
  deps: () => GitHubJobDeps = githubJobDeps,
): void {
  const { files = [], owners = [], account, ruleset } = delta ?? {};
  if (files.length === 0 || owners.length === 0) {
    console.log(SYNC_FILES_SKIP);
    return;
  }
  const d = deps();
  if (!ghReady(d)) return;
  syncAll(
    {
      files,
      owners,
      account,
      ruleset,
      live: flags.live === true,
      root: paths().scriptsDir,
    },
    d,
  );
}

export default defineRunnable({
  id: SYNC_FILES_ID,
  domain: 'github',
  flags: syncFilesFlags,
  run: ({ flags }) => {
    syncFiles(flags);
  },
});
