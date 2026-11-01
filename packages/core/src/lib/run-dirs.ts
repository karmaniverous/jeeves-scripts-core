/**
 * @module lib/run-dirs
 *
 * Timestamped run directories for runnables that hand a worker a snapshot
 * of files (`slack-refresh-channel-meta`, and instance runnables through
 * the root export): each run writes `<root>/<YYYYMMDD-HHMMSS>/`
 * ({@link runId}, UTC) and {@link pruneRuns} keeps the newest few.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Run directory names: a UTC timestamp. */
const RUN_DIR_PATTERN = /^\d{8}-\d{6}$/;

/** The run id for a time (`YYYYMMDD-HHMMSS`, UTC). */
export const runId = (now: Date): string =>
  now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * Delete all but the newest `keep` run directories under `root` (other
 * entries are left alone).
 *
 * @param root - Directory holding run directories.
 * @param keep - How many to keep.
 * @returns The directories removed (none when `root` can't be read).
 */
export function pruneRuns(root: string, keep: number): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root).filter((n) => RUN_DIR_PATTERN.test(n));
  } catch {
    return [];
  }
  const doomed = names.sort().reverse().slice(keep);
  for (const n of doomed)
    fs.rmSync(path.join(root, n), { recursive: true, force: true });
  return doomed;
}
