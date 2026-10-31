/**
 * @module library/lib/clone
 *
 * The library mirror's working clone (spec 2.9 step 2): a shallow clone
 * of one ref, kept in the state dir. An existing clone fetches the ref
 * and hard-resets to it; a clone that can't be updated is a cache, so it
 * is deleted and cloned again. Checkouts never convert line endings
 * (`core.autocrlf=false`, `core.eol=lf`, whatever the host's git config
 * says), so the mirror holds the repo's bytes on every platform.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, getErrorMessage } from '@karmaniverous/jeeves';

/** Runs a command and returns its trimmed stdout; throws on failure. */
export type RunCommand = (cmd: string, args: string[]) => string;

/** Git options for every call: checkouts keep the repo's bytes. */
const BYTE_EXACT = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf'];

/** What {@link updateClone} calls. */
export interface CloneDeps {
  /** Command runner (`run` from `@karmaniverous/jeeves`). */
  run: RunCommand;
  /** Progress logger. */
  log: (line: string) => void;
}

/** A fresh shallow clone of `ref` into `dir` (removing whatever is there). */
const freshClone = (
  deps: CloneDeps,
  url: string,
  ref: string,
  dir: string,
): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(path.dirname(dir));
  deps.log(`CLONE ${url} (${ref})`);
  deps.run('git', [
    ...BYTE_EXACT,
    'clone',
    '--depth',
    '1',
    '--branch',
    ref,
    url,
    dir,
  ]);
};

/** Bring an existing clone to `ref` as it is now upstream. */
const pull = (deps: CloneDeps, url: string, ref: string, dir: string): void => {
  const git = (...args: string[]) =>
    deps.run('git', [...BYTE_EXACT, '-C', dir, ...args]);
  git('remote', 'set-url', 'origin', url);
  git('fetch', '--depth', '1', 'origin', ref);
  git('reset', '--hard', 'FETCH_HEAD');
  git('clean', '-fdx');
};

/**
 * Clone `url` at `ref` into `dir`, or update the clone already there;
 * returns the short head SHA.
 *
 * @throws When the ref can't be cloned (after one fresh attempt when an
 *   existing clone couldn't be updated).
 */
export const updateClone = (
  deps: CloneDeps,
  url: string,
  ref: string,
  dir: string,
): string => {
  if (!fs.existsSync(path.join(dir, '.git'))) freshClone(deps, url, ref, dir);
  else
    try {
      pull(deps, url, ref, dir);
    } catch (e) {
      deps.log(`RECLONE ${dir}: update failed: ${getErrorMessage(e)}`);
      freshClone(deps, url, ref, dir);
    }
  return deps.run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']);
};
