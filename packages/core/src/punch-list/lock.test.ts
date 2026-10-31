import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withLock } from './lock.js';

const lockPath = (): string =>
  join(mkdtempSync(join(tmpdir(), 'pl-lock-')), 'sub', 'x.lock');

describe('withLock', () => {
  it('holds the lock while running and releases it after, even on error', () => {
    const file = lockPath();
    expect(withLock(file, () => existsSync(file))).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(() =>
      withLock(file, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(file)).toBe(false);
  });

  it('waits for a live holder and gives up after waitMs', () => {
    const file = lockPath();
    withLock(file, () => {
      expect(() => withLock(file, () => 1, { waitMs: 50, pollMs: 10 })).toThrow(
        /still held/,
      );
    });
  });

  it('breaks a stale lock left by a crashed holder', () => {
    const file = lockPath();
    withLock(file, () => undefined);
    writeFileSync(file, '999999\n');
    const old = new Date(Date.now() - 120_000);
    utimesSync(file, old, old);
    expect(withLock(file, () => 'ran', { waitMs: 1000, pollMs: 10 })).toBe(
      'ran',
    );
  });
});
