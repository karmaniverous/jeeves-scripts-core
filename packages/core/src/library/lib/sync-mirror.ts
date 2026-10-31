/**
 * @module library/lib/sync-mirror
 *
 * One mirror end to end (spec 2.9 steps 1-8): resolve its directories
 * under `{stateDir}/library/<id>/` and `{contentDir}/<dest>`, update the
 * clone, mirror the tree, and report; and every configured mirror in
 * order, where one mirror's failure never stops the rest but fails the
 * run once all have been tried (step 9).
 */

import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import type { LibraryMirror } from '../../config/library-schema.js';
import { type RunCommand, updateClone } from './clone.js';
import { type MirrorPaths, mirrorTree } from './mirror.js';
import { PUBLISH_RECORD_FILE } from './publish-record.js';

/** The runnable id, used as the log prefix and in failure messages. */
export const LIBRARY_SYNC_ID = 'library-sync-mirrors';

/** What every mirror in a run shares. */
export interface LibrarySettings {
  /** Write the content tree (`--live`); otherwise report only. */
  live: boolean;
  /** `paths().stateDir`: clones and staging live under `library/<id>/`. */
  stateDir: string;
  /** `paths().contentDir`: each mirror's `dest` is relative to it. */
  contentDir: string;
}

/** What a mirror run calls. */
export interface LibraryDeps {
  /** Command runner for `git` and `rsync`. */
  run: RunCommand;
  /** The anonymous clone URL of `owner/repo`. */
  cloneUrl: (repo: string) => string;
  /** Progress logger. */
  log: (line: string) => void;
  /** Platform rsync paths are written for (default `process.platform`). */
  platform?: NodeJS.Platform;
  /** Filesystem device of a path (default: of its nearest existing ancestor). */
  deviceOf?: (p: string) => number;
}

/** One mirror's outcome, as `JR_RESULT` reports it. */
export interface MirrorReport {
  /** The mirror id. */
  id: string;
  /** Short head SHA of the mirrored ref. */
  head: string;
  /** Files in the staged tree. */
  files: number;
  /** Site links rewritten. */
  links: number;
  /** Files written (or, dry, that would be). */
  write: number;
  /** Files whose attributes only were updated. */
  touch: number;
  /** Paths deleted. */
  delete: number;
  /** True when this run created the destination (or would have). */
  created: boolean;
}

/** The public HTTPS clone URL of `owner/repo` (no credentials). */
export const githubCloneUrl = (repo: string): string =>
  `https://github.com/${repo}.git`;

/** A mirror's directories: clone and staging in the state dir, dest in the content dir. */
export const mirrorDirs = (
  mirror: Pick<LibraryMirror, 'id' | 'subdir' | 'dest'>,
  settings: Pick<LibrarySettings, 'stateDir' | 'contentDir'>,
): MirrorPaths => {
  const root = path.join(settings.stateDir, 'library', mirror.id);
  const clone = path.join(root, 'clone');
  return {
    clone,
    source: path.join(clone, mirror.subdir),
    stage: path.join(root, 'stage'),
    tmp: path.join(root, 'tmp'),
    incoming: path.join(root, 'incoming'),
    dest: path.resolve(settings.contentDir, mirror.dest),
    record: path.join(root, PUBLISH_RECORD_FILE),
  };
};

/** The log line for one mirror's outcome. */
export const reportLine = (r: MirrorReport, live: boolean): string =>
  `${r.id}: ${live ? 'live' : 'dry-run'} head=${r.head} files=${String(r.files)} links=${String(r.links)} write=${String(r.write)} touch=${String(r.touch)} delete=${String(r.delete)}${r.created ? ' created' : ''}`;

/** Sync one mirror: update its clone, then mirror its tree. */
export const syncMirror = (
  mirror: LibraryMirror,
  settings: LibrarySettings,
  deps: LibraryDeps,
): MirrorReport => {
  const dirs = mirrorDirs(mirror, settings);
  const head = updateClone(
    deps,
    deps.cloneUrl(mirror.repo),
    mirror.ref,
    dirs.clone,
  );
  const r = mirrorTree({
    paths: dirs,
    live: settings.live,
    head,
    adopt: mirror.adopt,
    exclude: mirror.exclude,
    minRatio: mirror.minRatio,
    siteLinks: mirror.siteLinks,
    run: deps.run,
    ...(deps.platform ? { platform: deps.platform } : {}),
    ...(deps.deviceOf ? { deviceOf: deps.deviceOf } : {}),
    log: (line) => {
      deps.log(`${mirror.id}: ${line}`);
    },
  });
  return {
    id: mirror.id,
    head,
    files: r.files,
    links: r.links,
    write: r.written,
    touch: r.touched,
    delete: r.deleted,
    created: r.created,
  };
};

/**
 * Sync every mirror in order, log each outcome and one `JR_RESULT` line
 * (`meta`: one summary per mirror; `mirrors`: the reports; `failed`: the
 * failures by id), and return the reports.
 *
 * @throws After every mirror was tried, when any failed.
 */
export const syncMirrors = (
  mirrors: readonly LibraryMirror[],
  settings: LibrarySettings,
  deps: LibraryDeps,
): MirrorReport[] => {
  if (!settings.live) deps.log('DRY RUN: pass --live to write');
  const reports: MirrorReport[] = [];
  const failed: Record<string, string> = {};
  for (const mirror of mirrors) {
    try {
      const r = syncMirror(mirror, settings, deps);
      reports.push(r);
      deps.log(reportLine(r, settings.live));
    } catch (e) {
      failed[mirror.id] = getErrorMessage(e);
      deps.log(`${mirror.id}: FAILED: ${getErrorMessage(e)}`);
    }
  }
  const meta = [
    ...reports.map((r) => reportLine(r, settings.live)),
    ...Object.keys(failed).map((id) => `${id}: FAILED`),
  ].join('; ');
  console.log(
    `JR_RESULT:${JSON.stringify({ meta, mirrors: reports, failed })}`,
  );
  const ids = Object.keys(failed);
  if (ids.length > 0)
    throw new Error(
      `${LIBRARY_SYNC_ID}: ${String(ids.length)} of ${String(mirrors.length)} mirrors failed: ${ids.map((id) => `${id} (${failed[id] ?? ''})`).join('; ')}`,
    );
  return reports;
};
