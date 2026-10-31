/**
 * @module punch-list/lock
 *
 * A cross-process lock file. Every job that writes
 * the punch list holds it across load → change → write, so the status
 * checker and the harvester cannot overwrite each other. People and the
 * assistant edit without it; the store's re-read before writing covers
 * them. A lock older than `staleMs` (a crashed holder) is broken.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

export interface LockOptions {
  /** A lock file older than this is a crashed holder's and is removed. */
  staleMs?: number;
  /** Give up after waiting this long. */
  waitMs?: number;
  /** Poll interval while waiting. */
  pollMs?: number;
  now?: () => number;
}

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const isCode = (err: unknown, code: string): boolean =>
  err instanceof Error && 'code' in err && err.code === code;

const tryAcquire = (file: string): boolean => {
  try {
    const fd = openSync(file, 'wx');
    writeSync(fd, `${String(process.pid)}\n`);
    closeSync(fd);
    return true;
  } catch (err) {
    if (isCode(err, 'EEXIST')) return false;
    throw err;
  }
};

const breakIfStale = (file: string, staleMs: number, now: number): void => {
  try {
    if (now - statSync(file).mtimeMs > staleMs) unlinkSync(file);
  } catch (err) {
    if (!isCode(err, 'ENOENT')) throw err;
  }
};

/**
 * Run `fn` while holding `file`.
 *
 * @throws When the lock is still held after `waitMs`.
 */
export const withLock = <T>(
  file: string,
  fn: () => T,
  options: LockOptions = {},
): T => {
  const {
    staleMs = 60_000,
    waitMs = 30_000,
    pollMs = 100,
    now = Date.now,
  } = options;
  mkdirSync(dirname(file), { recursive: true });
  const deadline = now() + waitMs;
  while (!tryAcquire(file)) {
    breakIfStale(file, staleMs, now());
    if (now() >= deadline)
      throw new Error(
        `punch list lock ${file} still held after ${String(waitMs)} ms`,
      );
    sleep(pollMs);
  }
  try {
    return fn();
  } finally {
    unlinkSync(file);
  }
};
