/**
 * Tests for the X post publisher with injected collaborators: due items
 * posted, future and unreadable ones left, retries and the failed folder.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { XPostBody } from './lib/x-client.js';
import {
  captureConsole,
  unstubbedXClient,
  X_NOW,
  type XWorld,
  xWorld,
} from './lib/x-deps.test-helper.js';
import { MAX_RETRIES, postQueue } from './post.js';

let w: XWorld;
let logs: string[];

beforeEach(() => {
  w = xWorld();
  ({ logs } = captureConsole());
});
afterEach(() => {
  vi.restoreAllMocks();
  w.cleanup();
});

describe('postQueue', () => {
  const queueDir = () => path.join(w.accountDir, 'queue');
  const enqueue = (file: string, item: unknown) => {
    fs.mkdirSync(queueDir(), { recursive: true });
    fs.writeFileSync(
      path.join(queueDir(), file),
      typeof item === 'string' ? item : JSON.stringify(item),
    );
  };

  it('posts due items (tweet, reply, quote), leaves future ones and ignores unreadable files', async () => {
    const create = vi.fn((body: XPostBody) =>
      Promise.resolve({ data: { id: `p-${body.text}` } }),
    );
    w = xWorld({ ...unstubbedXClient(), posts: { create } });
    enqueue('a.json', { text: 'hello' });
    enqueue('b.json', { text: 're', type: 'reply', replyToId: '9' });
    enqueue('c.json', { text: 'qt', type: 'quote', quoteId: '8' });
    enqueue('d.json', { text: 'later', targetTime: '2027-01-01T00:00:00Z' });
    enqueue('e.json', '{bad');
    enqueue('notes.txt', 'x');
    await postQueue('example', w.deps);
    expect(create).toHaveBeenCalledTimes(3);
    expect(fs.readdirSync(path.join(queueDir(), 'done')).sort()).toEqual([
      'a.json',
      'b.json',
      'c.json',
    ]);
    const posted = JSON.parse(
      fs.readFileSync(path.join(w.accountDir, 'posts', 'p-re.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(posted).toMatchObject({
      id: 'p-re',
      type: 'reply',
      postedAt: X_NOW.toISOString(),
      via: 'x-api-v2',
    });
    expect(logs).toContain('post: posted=3, skipped=1, failed=0');
  });

  it('records a failure, retries, then moves the file to failed/', async () => {
    const deps = {
      ...w.deps,
      withClient: () => Promise.reject(new Error('nope')),
    };
    enqueue('a.json', { text: 'x', retries: MAX_RETRIES - 2 });
    await postQueue('example', deps);
    const item = JSON.parse(
      fs.readFileSync(path.join(queueDir(), 'a.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(item).toMatchObject({ retries: MAX_RETRIES - 1, lastError: 'nope' });
    expect(logs).toContain(
      `post: retry ${String(MAX_RETRIES - 1)}/${String(MAX_RETRIES)} for a.json`,
    );
    await postQueue('example', deps);
    expect(fs.existsSync(path.join(queueDir(), 'failed', 'a.json'))).toBe(true);
    expect(logs).toContain(
      `post: FAILED after ${String(MAX_RETRIES)} retries: a.json`,
    );
  });

  it('names a tweet without an id after the clock, and fails for an unconfigured account', async () => {
    w = xWorld({
      ...unstubbedXClient(),
      posts: { create: () => Promise.resolve({}) },
    });
    enqueue('a.json', { text: 'x' });
    await postQueue('example', w.deps);
    expect(
      fs.existsSync(
        path.join(
          w.accountDir,
          'posts',
          `unknown-${String(X_NOW.getTime())}.json`,
        ),
      ),
    ).toBe(true);
    await expect(postQueue('ghost', w.deps)).rejects.toThrow(
      'X account ghost is not configured.',
    );
  });
});
