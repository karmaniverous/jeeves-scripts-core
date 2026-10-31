/**
 * @module github/lib/file-sources
 *
 * Read `github-sync-files`' `files[].source` contents (spec 2.8) under the
 * instance repo root. The schema already refuses an absolute source or one
 * with a `..` segment; this checks again where the path is resolved, links
 * included, so nothing outside the root (keys, `gh` tokens) is ever read
 * and pushed to every targeted repo.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';

import type { GithubSyncFile } from '../../config/github-sync-files-schema.js';
import { isWithin } from '../../lib/path-within.js';
import type { FileContent } from './file-sync.js';
import { SYNC_FILES_ID } from './file-sync-tally.js';

/** `fn()`, with any failure reported as an unreadable `file`. */
const reading = <T>(file: string, fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw new Error(
      `${SYNC_FILES_ID}: cannot read files[].source ${file}: ${getErrorMessage(e)}`,
      { cause: e },
    );
  }
};

/**
 * Read every `source` under `root` up front, so a missing or escaping one
 * fails before any `gh` call.
 *
 * @throws When a source resolves outside `root` (lexically or through a
 *   link) or can't be read.
 */
export const readSources = (
  files: readonly GithubSyncFile[],
  root: string,
): FileContent[] =>
  files.map(({ source, target }) => {
    const file = path.resolve(root, source);
    const outside = () =>
      new Error(
        `${SYNC_FILES_ID}: files[].source ${source} resolves outside the instance root ${root}; not reading it`,
      );
    if (!isWithin(root, file)) throw outside();
    const real = reading(file, () => fs.realpathSync.native(file));
    if (!isWithin(fs.realpathSync.native(root), real)) throw outside();
    return { target, content: reading(file, () => fs.readFileSync(real)) };
  });
