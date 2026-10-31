/**
 * @module library/sync-mirrors
 *
 * Runnable `library-sync-mirrors` (spec 2.9, #35): mirrors each configured
 * public-repo subdirectory (`library.mirrors`) into the content tree as a
 * reference library, byte for byte apart from the configured link
 * rewrite, writing only changed files and never touching `.meta/`. Needs
 * no credentials (anonymous HTTPS clone). Dry run unless `--live`: the
 * clone and stage (state dir) are updated, the content tree only
 * reported. Its prerequisite skips the run (exit 0) when no mirror is
 * configured; with mirrors configured, a missing `git` or `rsync` fails
 * the run, so the runner's failure alert fires, and `doctor` reports it
 * as not met.
 */

import { argFlag, type ParsedArgs, run } from '@karmaniverous/jeeves';

import type { LibraryMirror } from '../config/library-schema.js';
import { loadConfig } from '../config/loader.js';
import { paths } from '../config/paths.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import {
  githubCloneUrl,
  LIBRARY_SYNC_ID,
  type LibraryDeps,
  syncMirrors,
} from './lib/sync-mirror.js';

/** The prerequisite's reason when `library.mirrors` is empty or absent. */
export const NO_MIRRORS = 'no library.mirrors configured';

/** The commands a mirror run needs on `PATH`, and how to install each. */
const TOOLS = {
  git: 'Linux: apt install git; Windows: choco install git',
  rsync: 'Linux: apt install rsync; Windows: choco install rsync',
} as const;

/** Whether `cmd --version` runs (the command is on `PATH`). */
export const onPath = (cmd: string): boolean => {
  try {
    run(cmd, ['--version']);
    return true;
  } catch {
    return false;
  }
};

/** `true` when `mirrors` is non-empty; else the reason the run is skipped. */
export const libraryPrerequisite = (
  mirrors: readonly LibraryMirror[],
): true | string => (mirrors.length === 0 ? NO_MIRRORS : true);

/**
 * `true` when `git` and `rsync` are on `PATH`; else the error that fails
 * a run with mirrors configured, naming each missing tool and how to
 * install it (`doctor` reports it as not met).
 */
export const libraryTools = (
  has: (cmd: string) => boolean = onPath,
): true | string => {
  const missing = (Object.keys(TOOLS) as (keyof typeof TOOLS)[]).filter(
    (cmd) => !has(cmd),
  );
  if (missing.length === 0) return true;
  const install = missing.map((cmd) => `${cmd}: ${TOOLS[cmd]}`).join('; ');
  return `${missing.join(' and ')} not found on PATH: ${LIBRARY_SYNC_ID} needs git and rsync to run library.mirrors (install ${install})`;
};

/** The default collaborators: real `git` and `rsync`, GitHub HTTPS URLs. */
export const libraryDeps = (): LibraryDeps => ({
  run,
  cloneUrl: githubCloneUrl,
  log: (line) => {
    console.log(`[${LIBRARY_SYNC_ID}] ${line}`);
  },
});

/** The flags `library-sync-mirrors` accepts. */
export const syncMirrorsFlags = {
  live: argFlag('--live', 'Write the content tree (default: dry run)'),
};

/**
 * Run every configured mirror with the instance's paths; with none
 * configured, log the skip line and return.
 *
 * @throws With mirrors configured, when `git` or `rsync` is not on
 *   `PATH` (see {@link libraryTools}), before any mirror runs.
 */
export const runMirrors = (
  flags: Partial<ParsedArgs<typeof syncMirrorsFlags>>,
  deps: LibraryDeps = libraryDeps(),
  has: (cmd: string) => boolean = onPath,
): void => {
  const { mirrors } = loadConfig().library;
  const ready = libraryPrerequisite(mirrors);
  if (ready !== true) {
    console.log(`[skip] ${ready}`);
    return;
  }
  const tools = libraryTools(has);
  if (tools !== true) throw new Error(tools);
  const { stateDir, contentDir } = paths();
  syncMirrors(
    mirrors,
    { live: flags.live === true, stateDir, contentDir },
    deps,
  );
};

export default defineRunnable({
  id: LIBRARY_SYNC_ID,
  domain: 'library',
  flags: syncMirrorsFlags,
  prerequisite: () => libraryPrerequisite(loadConfig().library.mirrors),
  doctorCheck: () => libraryTools(),
  run: ({ flags }) => {
    runMirrors(flags);
  },
});
