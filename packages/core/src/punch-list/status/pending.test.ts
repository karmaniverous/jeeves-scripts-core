import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { postQueued, readPending, writePending } from './pending.js';

const file = (): string =>
  join(mkdtempSync(join(tmpdir(), 'pl-pending-')), 'state', 'pending.json');

describe('pending notifications', () => {
  it('round-trips the queue and removes the file when empty', () => {
    const f = file();
    expect(readPending(f)).toEqual([]);
    writePending(f, ['a', 'b']);
    expect(readPending(f)).toEqual(['a', 'b']);
    writePending(f, []);
    expect(existsSync(f)).toBe(false);
  });

  it('posts leftovers first, then fresh messages, and clears the queue', async () => {
    const f = file();
    writePending(f, ['old']);
    const posted: string[] = [];
    await postQueued(f, ['new'], (m) => {
      posted.push(m);
      return Promise.resolve();
    });
    expect(posted).toEqual(['old', 'new']);
    expect(readPending(f)).toEqual([]);
  });

  it('keeps the failed message and everything after it for the next run', async () => {
    const f = file();
    const post = (m: string): Promise<void> =>
      m === 'b' ? Promise.reject(new Error('slack down')) : Promise.resolve();
    await expect(postQueued(f, ['a', 'b', 'c'], post)).rejects.toThrow(
      'slack down',
    );
    expect(readPending(f)).toEqual(['b', 'c']);
  });
});
