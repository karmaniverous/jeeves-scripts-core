/**
 * `withLock` propagates filesystem errors other than the ones it expects
 * (`EEXIST` on acquiring, `ENOENT` when the stale lock vanished first).
 */

import type * as Fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const fail = vi.hoisted(() => ({ open: '', stat: '' }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof Fs>();
  const coded = (code: string): Error =>
    Object.assign(new Error(`${code}: mocked`), { code });
  return {
    ...real,
    openSync: (...args: Parameters<typeof real.openSync>) => {
      if (fail.open) throw coded(fail.open);
      return real.openSync(...args);
    },
    statSync: ((...args: Parameters<typeof real.statSync>) => {
      if (fail.stat) throw coded(fail.stat);
      return real.statSync(...args);
    }) as typeof real.statSync,
  };
});

import { withLock } from './lock.js';

const lockPath = (): string =>
  join(mkdtempSync(join(tmpdir(), 'pl-lock-err-')), 'x.lock');

afterEach(() => {
  fail.open = '';
  fail.stat = '';
});

describe('withLock filesystem errors', () => {
  it('rethrows an acquire error other than EEXIST', () => {
    fail.open = 'EACCES';
    expect(() => withLock(lockPath(), () => 1)).toThrow('EACCES: mocked');
  });

  it('rethrows a stale-check error other than ENOENT', () => {
    const file = lockPath();
    withLock(file, () => {
      fail.stat = 'EIO';
      expect(() => withLock(file, () => 1, { waitMs: 50, pollMs: 10 })).toThrow(
        'EIO: mocked',
      );
      fail.stat = '';
    });
  });

  it('carries on when the stale lock vanished before the check', () => {
    const file = lockPath();
    withLock(file, () => {
      fail.stat = 'ENOENT';
      expect(() => withLock(file, () => 1, { waitMs: 30, pollMs: 10 })).toThrow(
        /still held after 30 ms/,
      );
      fail.stat = '';
    });
  });
});
