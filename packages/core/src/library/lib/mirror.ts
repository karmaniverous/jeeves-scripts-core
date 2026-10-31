/**
 * @module library/lib/mirror
 *
 * `mirrorTree` (spec 2.9 steps 3-7): stage a source tree (`stage`), check
 * the guards, then publish it: a first run assembles the tree beside the destination and
 * renames it in one step; later runs rsync only the changed files into
 * place through a temp dir. `.meta/` in the destination is never touched.
 * An existing destination this mirror has no publish record for is
 * refused unless `adopt` (see `publish-record`); each live publish is
 * recorded. Staging always runs (it lives in the state dir); the
 * destination, `incoming`, `tmp` and the record are written only when
 * `live`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, run } from '@karmaniverous/jeeves';

import type { LibrarySiteLinks } from '../../config/library-schema.js';
import { isWithin } from '../../lib/path-within.js';
import type { RunCommand } from './clone.js';
import { isUnownedDest, writePublishRecord } from './publish-record.js';
import {
  rsyncArgs,
  type RsyncRunner,
  type RsyncSummary,
  summarizeRsync,
} from './rsync.js';
import { listFiles, stageTree } from './stage.js';

/** Destination paths the mirror never modifies or deletes (meta output). */
export const LIBRARY_DEST_PROTECT: readonly string[] = ['.meta/'];

/** The directories one mirror run uses. */
export interface MirrorPaths {
  /** The clone: `source`, symlinks resolved, must lie inside it. */
  clone: string;
  /** Tree to mirror (the clone, or its subdirectory). */
  source: string;
  /** Staging copy in the state dir: the source plus link rewrites. */
  stage: string;
  /** rsync temp dir, so the destination never holds a partial file. */
  tmp: string;
  /** First-run assembly dir, renamed into `dest` in one step. */
  incoming: string;
  /** The mirror in the content tree. */
  dest: string;
  /** The publish record in the state dir (`published.json`). */
  record: string;
}

/** Options for {@link mirrorTree}. */
export interface MirrorOptions {
  /** The directories. */
  paths: MirrorPaths;
  /** Write the destination; otherwise report only. */
  live: boolean;
  /** The head SHA being mirrored, recorded after a live publish. */
  head: string;
  /** Take over an existing destination this mirror has no publish record for. */
  adopt?: boolean | undefined;
  /** rsync filter patterns left out of the stage (`.git/` always is). */
  exclude: readonly string[];
  /** Fail when the staged file count is below this share of the mirrored count. */
  minRatio: number;
  /** Site links to rewrite in staged text files. */
  siteLinks?: LibrarySiteLinks | undefined;
  /** Command runner (default `run` from `@karmaniverous/jeeves`). */
  run?: RunCommand;
  /** Platform rsync paths are written for (default `process.platform`). */
  platform?: NodeJS.Platform;
  /** Filesystem device of a path (default: of its nearest existing ancestor). */
  deviceOf?: (p: string) => number;
  /** Progress logger (default `console.log`). */
  log?: (line: string) => void;
}

/** What one mirror run did (or, dry, would do). */
export interface MirrorResult extends RsyncSummary {
  /** Files in the staged tree. */
  files: number;
  /** Site links rewritten in the stage. */
  links: number;
  /** True when this run created the destination (or would have). */
  created: boolean;
}

/**
 * Refuse a source that resolves outside the clone: an untrusted repo can
 * make `subdir` (or a directory above it) a symlink to a host directory,
 * which rsync, given `source/`, would descend into.
 */
const assertInsideClone = (paths: MirrorPaths): void => {
  const real = fs.realpathSync.native;
  if (!isWithin(real(paths.clone), real(paths.source)))
    throw new Error(
      `source ${paths.source} resolves outside the clone ${paths.clone}; refusing to mirror it`,
    );
};

/** Device of the nearest existing ancestor of `p`. */
const statDevice = (p: string): number => {
  let cur = p;
  while (!fs.existsSync(cur)) cur = path.dirname(cur);
  return fs.statSync(cur).dev;
};

/** The guards that need no staging: the source exists inside the clone, on the destination's filesystem. */
const checkSource = (
  paths: MirrorPaths,
  deviceOf: (p: string) => number,
): void => {
  if (!fs.existsSync(paths.source))
    throw new Error(`source not found: ${paths.source}`);
  assertInsideClone(paths);
  if (deviceOf(paths.stage) !== deviceOf(paths.dest))
    throw new Error(
      `${paths.stage} and ${paths.dest} are on different filesystems; renames would not be atomic`,
    );
};

/** Refuse an existing destination this mirror doesn't own (unless `adopt`), or a shrink below `minRatio`. */
const checkDest = (
  opts: MirrorOptions,
  staged: number,
  created: boolean,
  log: (line: string) => void,
): void => {
  const { paths, live } = opts;
  if (isUnownedDest(paths.record, paths.dest)) {
    if (!opts.adopt)
      throw new Error(
        live
          ? `refusing to publish: ${paths.dest} exists and was not written by this mirror; set adopt: true on the mirror to take it over`
          : `would refuse: ${paths.dest} exists and was not written by this mirror (set adopt: true)`,
      );
    log(`${live ? 'ADOPTING' : 'WOULD ADOPT'} ${paths.dest} (adopt: true)`);
  }
  const current = listFiles(paths.dest, ['.meta']).length;
  if (!created && staged < current * opts.minRatio)
    throw new Error(
      `source has ${String(staged)} files vs ${String(current)} mirrored; refusing to shrink the mirror below ${String(opts.minRatio * 100)}%`,
    );
};

/** Mirror the stage into the destination (first run: one rename); returns rsync's output. */
const publish = (
  opts: MirrorOptions,
  rsync: RsyncRunner,
  created: boolean,
  log: (line: string) => void,
): string => {
  const { paths, live } = opts;
  if (!created) {
    if (live) ensureDir(paths.tmp);
    return rsync({
      source: paths.stage,
      dest: paths.dest,
      exclude: LIBRARY_DEST_PROTECT,
      tempDir: live ? paths.tmp : undefined,
      dryRun: !live,
    });
  }
  // A failed live run can leave `incoming` behind: live clears it; a dry
  // run compares against the absent `dest` instead, so it reports the
  // whole tree as new without writing anything.
  if (live) fs.rmSync(paths.incoming, { recursive: true, force: true });
  const output = rsync({
    source: paths.stage,
    dest: live ? paths.incoming : paths.dest,
    exclude: [],
    dryRun: !live,
  });
  if (live) {
    ensureDir(path.dirname(paths.dest));
    fs.renameSync(paths.incoming, paths.dest);
  }
  log(`${live ? 'CREATED' : 'WOULD CREATE'} ${paths.dest} (single rename)`);
  return output;
};

/**
 * Stage `paths.source`, rewrite links, check the guards, and mirror the
 * stage into `paths.dest`.
 *
 * @throws Before the destination is touched, when the source is missing
 *   or resolves outside the clone, the stage and destination are on
 *   different filesystems (renames would not be atomic), the staged tree
 *   is empty, the destination exists with content this mirror didn't
 *   write and `adopt` is not set, or the staged tree holds fewer than
 *   `minRatio` of the files now mirrored; and on any rsync error.
 */
export const mirrorTree = (opts: MirrorOptions): MirrorResult => {
  const { paths, live } = opts;
  const log = opts.log ?? console.log;
  const exec = opts.run ?? run;
  const rsync: RsyncRunner = (args) =>
    exec('rsync', rsyncArgs(args, opts.platform));

  checkSource(paths, opts.deviceOf ?? statDevice);
  const { staged, links } = stageTree(
    {
      source: paths.source,
      stage: paths.stage,
      exclude: opts.exclude,
      siteLinks: opts.siteLinks,
    },
    rsync,
    log,
  );
  const created = !fs.existsSync(paths.dest);
  checkDest(opts, staged.length, created, log);
  const output = publish(opts, rsync, created, log);
  if (live)
    writePublishRecord(paths.record, {
      dest: path.resolve(paths.dest),
      head: opts.head,
      publishedAt: new Date().toISOString(),
    });
  return {
    ...summarizeRsync(output),
    files: staged.length,
    links,
    created,
  };
};
