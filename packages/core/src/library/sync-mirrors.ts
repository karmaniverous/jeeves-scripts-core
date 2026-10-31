/**
 * @module library/sync-mirrors
 *
 * Runnable `library-sync-mirrors` (spec 2.9, #35): mirrors each configured
 * public-repo subdirectory (`library.mirrors`) into the content tree as a
 * reference library, byte for byte apart from the configured link
 * rewrite, writing only changed files and never touching `.meta/`. Needs
 * no credentials (anonymous HTTPS clone). Dry run unless `--live`: the
 * clone and stage (state dir) are updated, the content tree only
 * reported. Its prerequisite skips the run when no mirror is configured,
 * or when `git` or `rsync` is not on `PATH` (so `doctor` reports it).
 */

import { run } from '@karmaniverous/jeeves';

import type { LibraryMirror } from '../config/library-schema.js';
import { loadConfig } from '../config/loader.js';
import { paths } from '../config/paths.js';
import { argFlag, type ParsedArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import {
  githubCloneUrl,
  LIBRARY_SYNC_ID,
  type LibraryDeps,
  syncMirrors,
} from './lib/sync-mirror.js';

/** The prerequisite's reason when `library.mirrors` is empty or absent. */
export const NO_MIRRORS = 'no library.mirrors configured';

/** The commands a mirror run needs on `PATH`. */
const TOOLS = ['git', 'rsync'] as const;

/** Whether `cmd --version` runs (the command is on `PATH`). */
export const onPath = (cmd: string): boolean => {
  try {
    run(cmd, ['--version']);
    return true;
  } catch {
    return false;
  }
};

/**
 * `true` when `mirrors` is non-empty and `git` and `rsync` are on `PATH`;
 * else the reason the run is skipped.
 */
export const libraryPrerequisite = (
  mirrors: readonly LibraryMirror[],
  has: (cmd: string) => boolean = onPath,
): true | string => {
  if (mirrors.length === 0) return NO_MIRRORS;
  const missing = TOOLS.filter((cmd) => !has(cmd));
  return missing.length === 0
    ? true
    : `${missing.join(' and ')} not found on PATH (library-sync-mirrors needs git and rsync)`;
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
 */
export const runMirrors = (
  flags: Partial<ParsedArgs<typeof syncMirrorsFlags>>,
  deps: LibraryDeps = libraryDeps(),
): void => {
  const { mirrors } = loadConfig().library;
  if (mirrors.length === 0) {
    console.log(`[skip] ${NO_MIRRORS}`);
    return;
  }
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
  run: ({ flags }) => {
    runMirrors(flags);
  },
});
