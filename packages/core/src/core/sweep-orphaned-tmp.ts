#!/usr/bin/env tsx
/**
 * @module sweep-orphaned-tmp
 *
 * Housekeeping script that removes orphaned .tmp files from workspace
 * directories. These files are left behind by atomic write operations
 * (write to .tmp, rename to target) when a process crashes mid-write.
 *
 * Scans constants().CONTENT_DIR and constants().SCRIPTS_DIR for .tmp files older than the
 * configured max age and deletes them. Directories that don't exist
 * are silently skipped.
 *
 * Config dependencies: constants().CONTENT_DIR, constants().SCRIPTS_DIR from constants.ts.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import { constants } from '../lib/constants.js';

/** Maximum age in milliseconds before a .tmp file is considered orphaned (1 hour). */
const MAX_AGE_MS = 60 * 60 * 1000;

/** Directories to scan for orphaned .tmp files. */
const SWEEP_DIRS = [constants().CONTENT_DIR, constants().SCRIPTS_DIR];

/**
 * Recursively find and delete .tmp files older than MAX_AGE_MS.
 */
function sweepDir(dir: string, now: number): number {
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
        // TOCTOU: file may vanish between readdirSync and lstatSync.
        const isEnoent =
          err instanceof Error && 'code' in err && err.code === 'ENOENT';
        if (!isEnoent) throw err;
      }
    }
  }

  return removed;
}

function main() {
  const now = Date.now();
  let totalRemoved = 0;

  for (const dir of SWEEP_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const removed = sweepDir(dir, now);
    if (removed > 0) {
      console.log(
        `Removed ${String(removed)} orphaned .tmp file(s) from ${dir}`,
      );
    }
    totalRemoved += removed;
  }

  if (totalRemoved === 0) {
    console.log('No orphaned .tmp files found.');
  }
}

runScript('core/sweep-orphaned-tmp', main);
