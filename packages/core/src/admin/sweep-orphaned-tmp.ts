/**
 * @module sweep-orphaned-tmp
 *
 * Housekeeping runnable `admin-sweep-orphaned-tmp`: removes orphaned .tmp
 * files left behind by atomic write operations (write to .tmp, rename to
 * target) when a process crashes mid-write.
 *
 * Sweeps `paths().contentDir`, `paths().scriptsDir` and the absolute
 * directories in `jobs.admin-sweep-orphaned-tmp.extraDirs` (Decision 55),
 * all with the same rules (`admin/lib/sweep-tmp.ts`). Config is read when
 * the job runs, never at import.
 */

import { loadConfig } from '../config/loader.js';
import { paths } from '../config/paths.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { sweepDirs } from './lib/sweep-tmp.js';

/** The runnable id; its `jobs.<id>` delta carries `extraDirs`. */
const JOB_ID = 'admin-sweep-orphaned-tmp';

/** The directories this run sweeps: content, scripts, then `extraDirs`. */
export function sweepTargets(): string[] {
  const p = paths();
  const extra = loadConfig().jobs[JOB_ID]?.extraDirs ?? [];
  return [p.contentDir, p.scriptsDir, ...extra];
}

/** Sweep {@link sweepTargets} as of `now`. */
export function sweepOrphanedTmp(now: number = Date.now()): void {
  sweepDirs(sweepTargets(), now);
}

export default defineRunnable({
  id: JOB_ID,
  domain: 'admin',
  flags: {},
  name: 'admin/sweep-orphaned-tmp',
  run: () => {
    sweepOrphanedTmp();
  },
});
