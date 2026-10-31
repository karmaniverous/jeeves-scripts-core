/**
 * @module library/lib/stage
 *
 * The library mirror's staging step (spec 2.9 steps 3-4): checksum-rsync
 * the source tree into the stage in the state dir (`exclude[]` and
 * `.git/` left out, files of a newly added exclude deleted), then rewrite
 * site links in its UTF-8 text files, keeping each rewritten file's
 * mtime. Also `listFiles`, the walk the mirror's counts use.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir } from '@karmaniverous/jeeves';

import type { LibrarySiteLinks } from '../../config/library-schema.js';
import {
  indexLinkTargets,
  linkPattern,
  rewriteLinks,
} from './library-links.js';
import type { RsyncRunner } from './rsync.js';

/** Excluded from every source: the clone's own git metadata. */
const SOURCE_ALWAYS_EXCLUDED = '.git/';

/** What {@link stageTree} stages. */
export interface StageOptions {
  /** Tree to stage. */
  source: string;
  /** The stage directory. */
  stage: string;
  /** rsync filter patterns left out of the stage (`.git/` always is). */
  exclude: readonly string[];
  /** Site links to rewrite in staged text files. */
  siteLinks?: LibrarySiteLinks | undefined;
}

/**
 * Every file under `root`, relative and `/`-separated; `[]` when `root`
 * is missing. Directories named in `skip` are not descended into.
 */
export const listFiles = (
  root: string,
  skip: readonly string[] = [],
): string[] => {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!skip.includes(e.name)) walk(path.join(dir, e.name), next);
      } else if (e.isFile()) out.push(next);
    }
  };
  if (fs.existsSync(root)) walk(root, '');
  return out;
};

/** The file's text when it is UTF-8 that round-trips byte for byte, else undefined. */
const textOf = (buf: Buffer): string | undefined => {
  if (buf.includes(0)) return undefined;
  const text = buf.toString('utf8');
  return Buffer.from(text, 'utf8').equals(buf) ? text : undefined;
};

/**
 * Rewrite site links in every staged text file, restoring each changed
 * file's atime and mtime: staging restores the upstream content each run,
 * so without this the rewritten file would get a new mtime daily and the
 * publishing rsync would touch it in the destination.
 */
const rewriteStage = (
  stage: string,
  files: readonly string[],
  siteLinks: LibrarySiteLinks | undefined,
  log: (line: string) => void,
): number => {
  if (!siteLinks) return 0;
  const index = indexLinkTargets(files, siteLinks.target);
  const pattern = linkPattern(siteLinks.pattern);
  let total = 0;
  for (const rel of files) {
    const abs = path.join(stage, rel);
    const text = textOf(fs.readFileSync(abs));
    if (text === undefined) continue;
    const r = rewriteLinks(text, rel, index, pattern);
    if (r.rewritten === 0) continue;
    const { atime, mtime } = fs.statSync(abs);
    fs.writeFileSync(abs, r.text, 'utf8');
    fs.utimesSync(abs, atime, mtime);
    log(`LINKS ${rel}: ${String(r.rewritten)} rewritten`);
    total += r.rewritten;
  }
  return total;
};

/** Stage the source and rewrite its site links; throws on an empty stage. */
export const stageTree = (
  opts: StageOptions,
  rsync: RsyncRunner,
  log: (line: string) => void,
): { staged: string[]; links: number } => {
  ensureDir(opts.stage);
  rsync({
    source: opts.source,
    dest: opts.stage,
    exclude: [...opts.exclude, SOURCE_ALWAYS_EXCLUDED],
    // An exclude added since the last run drops what that run staged.
    deleteExcluded: true,
    dryRun: false,
  });
  const staged = listFiles(opts.stage);
  if (staged.length === 0)
    throw new Error(`no files to mirror in ${opts.source}`);
  return {
    staged,
    links: rewriteStage(opts.stage, staged, opts.siteLinks, log),
  };
};
