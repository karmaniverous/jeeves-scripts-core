/**
 * @module library/lib/publish-record
 *
 * A mirror's publish record, `{stateDir}/library/<id>/published.json`: the
 * destination its last live publish wrote, the head SHA it published and
 * when. It lives in the state dir, so the watcher never sees it. A live
 * run writes into a destination that already exists only when the record
 * names that destination, the destination holds nothing but `.meta/`, or
 * the mirror sets `adopt: true`; otherwise the mirror refuses, so a typo or
 * a reused `dest` never deletes content the mirror didn't write.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getErrorMessage } from '@karmaniverous/jeeves';
import { z } from 'zod';

import { readJsonFileIfExists, writeJsonFile } from '../../lib/json-file.js';

/** The publish record's file name in the mirror's state dir. */
export const PUBLISH_RECORD_FILE = 'published.json';

/** One successful live publish. */
export const publishRecordSchema = z.object({
  /** The destination written: absolute, as resolved from `contentDir` and `dest`. */
  dest: z.string().min(1),
  /** The head SHA published. */
  head: z.string().min(1),
  /** When it was published (ISO 8601). */
  publishedAt: z.string().min(1),
});

/** One successful live publish. */
export type PublishRecord = z.infer<typeof publishRecordSchema>;

/**
 * The record at `file`, or `undefined` when the mirror has never published.
 *
 * @throws When the file can't be read or is not a valid record, naming
 *   the file.
 */
export const readPublishRecord = (file: string): PublishRecord | undefined => {
  try {
    return readJsonFileIfExists(
      file,
      publishRecordSchema.optional(),
      undefined,
    );
  } catch (e) {
    throw new Error(
      `cannot read the publish record ${file}: ${getErrorMessage(e)}`,
      { cause: e },
    );
  }
};

/** Write the record (atomically) after a successful live publish. */
export const writePublishRecord = (
  file: string,
  record: PublishRecord,
): void => {
  writeJsonFile(file, record);
};

/**
 * Whether `dest` exists holding something besides `.meta/` that this
 * mirror's record does not claim: content the mirror didn't write, which a
 * live run takes over only with `adopt: true`.
 */
export const isUnownedDest = (file: string, dest: string): boolean => {
  if (!fs.existsSync(dest)) return false;
  if (readPublishRecord(file)?.dest === path.resolve(dest)) return false;
  return fs.readdirSync(dest).some((name) => name !== '.meta');
};
