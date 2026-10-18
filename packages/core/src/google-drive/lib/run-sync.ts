/**
 * @module google-drive/lib/run-sync
 *
 * One sync entry, end to end (spec §4–§7): enumerate → prepare → plan →
 * (live only) deletes, moves, ledger updates, budgeted downloads,
 * directory pruning, meta seeding. A dry run stops after planning and
 * writes nothing to disk or runner state.
 */

import fs from 'node:fs';
import path from 'node:path';

import { paths } from '../../config/index.js';
import { constants } from '../../lib/constants.js';
import {
  assertNoSymlinks,
  deleteFiles,
  moveFile,
  prepareStaging,
  pruneDirs,
  safeJoin,
  scanTree,
} from './apply.js';
import { resolveTargetDir, type SyncEntryConfig } from './config.js';
import { RECONVERT_KEY } from './content-key.js';
import { createDriveClient, type DriveClient } from './drive-client.js';
import { enumerate } from './enumerate.js';
import { type RunBudget, runQueue } from './execute.js';
import {
  createLedgerStore,
  type LedgerRecord,
  recordFingerprint,
  type RunnerState,
} from './ledger.js';
import type { FetchLike } from './meta-seed.js';
import { plan } from './plan.js';
import { prepare } from './prepare.js';
import { planLines, planSummary } from './report.js';
import { createPathResolver } from './resolve-path.js';
import { seedShareMetas } from './seed-metas.js';
import { emptySummary, type SyncSummary } from './summary.js';

export interface SyncOptions {
  live: boolean;
  allowMassDelete: boolean;
  /** The run budget, shared by every sync in the run. */
  budget: RunBudget;
  shouldStop: () => boolean;
  log: (line: string) => void;
  /** Seams (tests): default to gog, the instance content dir, the state dir and global fetch. */
  client?: DriveClient;
  contentDir?: string;
  stagingRoot?: string;
  fetchFn?: FetchLike;
  now?: () => Date;
  /**
   * Re-convert already-synced items whose written copy still holds inline
   * base64 images (`data:image/`), e.g. after upgrading to a release that
   * strips them. Their content key is invalidated, so the planner queues
   * them as updates (reported in a dry run, converted when live).
   */
  reconvert?: boolean;
}

/**
 * Invalidate the content key of every written record whose copy under
 * `targetDir` contains an inline base64 image. Mutates `ledger`. Reads only
 * regular files inside `targetDir`: a ledger path that escapes it, runs
 * through a symlinked directory, or is itself a symlink is skipped.
 *
 * @returns The number of records marked.
 */
export function markImageBloat(
  ledger: Map<string, LedgerRecord>,
  targetDir: string,
): number {
  let marked = 0;
  for (const record of ledger.values()) {
    if (!record.written || !record.localPath) continue;
    let file: string;
    try {
      file = safeJoin(targetDir, record.localPath);
    } catch {
      continue;
    }
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    if (!fs.readFileSync(file, 'utf8').includes('data:image/')) continue;
    record.written = { ...record.written, contentKey: RECONVERT_KEY };
    marked += 1;
  }
  return marked;
}

/**
 * The account's staging directory: exactly one level below `stagingRoot`.
 * It is wiped at startup, so an account that would resolve anywhere else
 * (config validation already requires a plain mailbox) is refused.
 *
 * @throws When `account` doesn't name a direct child of `stagingRoot`.
 */
export function stagingDirFor(stagingRoot: string, account: string): string {
  const root = path.resolve(stagingRoot);
  const dir = path.resolve(root, account);
  // Reject both separators on every platform ('\' is a filename char on POSIX).
  if (
    /[\\/]/.test(account) ||
    path.dirname(dir) !== root ||
    path.basename(dir) !== account
  ) {
    throw new Error(
      `google-drive: account "${account}" is not a safe staging directory name under ${root}`,
    );
  }
  return dir;
}

export async function syncOne(
  cfg: SyncEntryConfig,
  runner: RunnerState,
  opts: SyncOptions,
): Promise<SyncSummary> {
  const summary = emptySummary(cfg.account, opts.live);
  const now = opts.now ?? (() => new Date());
  const targetDir = resolveTargetDir(
    cfg.targetDir,
    opts.contentDir ?? constants().CONTENT_DIR,
  );
  const client = opts.client ?? createDriveClient(cfg.account);
  const store = createLedgerStore(runner, cfg.account, opts.live);

  const snapshot = enumerate(
    client,
    createPathResolver(client, cfg.pathResolution),
  );
  summary.shares = snapshot.shares.length;
  summary.enumerationErrors = snapshot.errors;
  summary.unresolvedShares = snapshot.shares
    .filter((s) => !s.pathResolved)
    .map((s) => s.id);

  const ledger = store.load();
  // Serialized as loaded, before anything can mutate a record: the write
  // step persists only records that actually changed (spec §6.2).
  const loaded = new Map(
    [...ledger].map(([id, rec]) => [id, recordFingerprint(rec)]),
  );
  assertNoSymlinks(opts.contentDir ?? constants().CONTENT_DIR, targetDir);
  if (opts.reconvert) {
    const marked = markImageBloat(ledger, targetDir);
    opts.log(
      `reconvert: ${String(marked)} item(s) with inline images ${opts.live ? 'queued for' : 'would be queued for'} re-conversion`,
    );
  }
  const prepared = prepare(snapshot, ledger, client, cfg, targetDir);
  const scan = scanTree(targetDir);
  const p = plan({
    items: prepared.items,
    ledger,
    diskFiles: scan.files,
    diskMetaDirs: scan.metaDirs,
    shareDirs: prepared.shareDirs,
    enumerationErrors: snapshot.errors.length,
    now: now(),
    deletion: cfg.deletion,
    allowMassDelete: opts.allowMassDelete,
  });
  Object.assign(summary, planSummary(prepared, p));
  for (const line of planLines(prepared, p)) opts.log(line);
  if (!opts.live) return summary;

  const stagingRoot =
    opts.stagingRoot ?? path.join(paths().stateDir, 'google-drive', 'tmp');
  const stagingDir = stagingDirFor(stagingRoot, cfg.account);
  prepareStaging(stagingDir, targetDir);

  deleteFiles(targetDir, p.fileDeletes);
  const persisted = new Set<string>();
  for (const m of p.moves) {
    moveFile(targetDir, m.from, m.to);
    const rec = p.records.get(m.id);
    if (rec) {
      rec.localPath = m.to;
      store.put(m.id, rec); // per move: an interruption loses at most this one
      persisted.add(m.id);
    }
  }
  // New or changed records only: an idle run writes nothing to the ledger.
  for (const [id, rec] of p.records) {
    if (!persisted.has(id) && loaded.get(id) !== recordFingerprint(rec))
      store.put(id, rec);
  }
  for (const id of p.ledgerRemovals) store.remove(id);

  Object.assign(
    summary,
    await runQueue({
      queue: p.queue,
      items: new Map(prepared.items.map((i) => [i.id, i])),
      files: prepared.files,
      kinds: prepared.kinds,
      records: p.records,
      store,
      client,
      targetDir,
      stagingDir,
      budget: opts.budget,
      sheets: cfg.conversion.sheets,
      shouldStop: opts.shouldStop,
      now,
    }),
  );

  const pruned = pruneDirs(
    targetDir,
    p.desiredDirs,
    p.metaDeletes,
    cfg.meta.lockStaleMinutes,
  );
  summary.removedDirs = pruned.removedDirs.length;
  summary.heldLocks = pruned.heldLocks;

  const rootDirs = new Set(prepared.shareDirs.map((s) => s.rootDir));
  const seeded = await seedShareMetas(
    targetDir,
    p.seedCandidates,
    rootDirs,
    cfg.meta,
    opts.fetchFn,
  );
  summary.seeded = seeded.seeded;
  summary.seedErrors = seeded.errors;
  return summary;
}
