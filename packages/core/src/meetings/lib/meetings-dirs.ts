/**
 * @module meetings-dirs
 *
 * The meetings directories across silos and the walk over the meeting
 * packages in them, shared by the transcript fetchers and extractors.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getEntityDirs } from '../../config/index.js';

/** The deduplicated meetings directories from the silo config. */
export function getMeetingsDirs(): string[] {
  return getEntityDirs('meetings');
}

/** One meeting package directory. */
export interface MeetingPackageDir {
  /** The meetings directory holding it. */
  meetingsDir: string;
  /** Its directory name (the meeting id). */
  meetingId: string;
  /** Its full path. */
  meetingPath: string;
}

/**
 * Every package directory under `meetingsDirs`. A missing meetings
 * directory is passed over; an unreadable one is reported to `onError`
 * (default: ignored) and passed over.
 */
export function* meetingPackages(
  meetingsDirs: readonly string[],
  onError: (meetingsDir: string, err: unknown) => void = () => undefined,
): Generator<MeetingPackageDir> {
  for (const meetingsDir of meetingsDirs) {
    if (!fs.existsSync(meetingsDir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
    } catch (err) {
      onError(meetingsDir, err);
      continue;
    }
    for (const entry of entries)
      if (entry.isDirectory())
        yield {
          meetingsDir,
          meetingId: entry.name,
          meetingPath: path.join(meetingsDir, entry.name),
        };
  }
}
