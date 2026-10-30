/**
 * @module sweep-tmp
 *
 * Removes orphaned `.tmp` files (left by crashed atomic writes) from a
 * list of directories: recursively, skipping `node_modules/` and `.git/`,
 * deleting `.tmp` files older than {@link MAX_AGE_MS}. Missing directories
 * are skipped. File-system side effects only; logging goes through `log`.
 *
 * Called by `admin/sweep-orphaned-tmp.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isEnoent } from '../../lib/fs-errors.js';

/** Maximum age in milliseconds before a .tmp file is considered orphaned (1 hour). */
export const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Recursively find and delete `.tmp` files under `dir` older than
 * {@link MAX_AGE_MS}; returns how many were removed.
 */
export function sweepDir(dir: string, now: number): number {
  let removed = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      removed += sweepDir(fullPath, now);
    } else if (entry.name.endsWith('.tmp')) {
      try {
        const stat = fs.lstatSync(fullPath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(fullPath);
          removed++;
        }
      } catch (err: unknown) {
        if (!isEnoent(err)) throw err;
      }
    }
  }

  return removed;
}

/**
 * Sweep each directory once (duplicates after `path.resolve` are dropped;
 * missing ones skipped), logging a line per directory with removals, or
 * one line when nothing was removed. Returns the total removed.
 */
export function sweepDirs(
  dirs: readonly string[],
  now: number,
  log: (line: string) => void = console.log,
): number {
  const unique = [...new Set(dirs.map((d) => path.resolve(d)))];
  let totalRemoved = 0;

  for (const dir of unique) {
    if (!fs.existsSync(dir)) continue;
    const removed = sweepDir(dir, now);
    if (removed > 0) {
      log(`Removed ${String(removed)} orphaned .tmp file(s) from ${dir}`);
    }
    totalRemoved += removed;
  }

  if (totalRemoved === 0) log('No orphaned .tmp files found.');
  return totalRemoved;
}
