/**
 * Tests for the X runnables' logic with injected collaborators: the
 * pollers, the feed poller, the queue actions, the post publisher, the
 * token refresh and the queue drain.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainXQueues } from './drain-queues.js';
import { runXPoller } from './lib/poll-x-items.js';
import {
  runXQueueAction,
  type XQueueActionOptions,
} from './lib/run-x-queue-action.js';
import { xJobDeps } from './lib/x-deps.js';
import { X_NOW, type XWorld, xWorld } from './lib/x-deps.test-helper.js';
import { pollFeeds, PRUNE_DAYS } from './poll-feed.js';
import { MAX_RETRIES, postQueue } from './post.js';
import { refreshXToken } from './refresh-token.js';

let w: XWorld;
let logs: string[];
let errors: string[];

const tweet = (id: string) => ({
  id,
  createdAt: '2026-01-01',
  text: `t${id}`,
  authorId: 'a',
});

beforeEach(() => {
  w = xWorld();
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  w.cleanup();
});

describe('runXPoller', () => {
  const options = (
    pollFn = vi.fn(() => Promise.resolve([tweet('1'), tweet('2')])),
  ) => ({
    pollFn,
    queuePrefix: 'x-posts',
    typeLabel: 'posts',
  });

  it('enqueues every fetched tweet for each configured handle with an OAuth file', async () => {
    const opts = options();
    await runXPoller(['--count', '5'], opts, w.deps);
    expect(opts.pollFn).toHaveBeenCalledWith({}, 'karma', { maxResults: 5 });
    const queued = w.runner.queues.get('x-posts-karma') ?? [];
    expect(queued.map((q) => (q.payload as { id: string }).id)).toEqual([
      '1',
      '2',
    ]);
    expect(queued[0]?.payload).toMatchObject({
      author: 'a',
      type: 'posts',
      text: 't1',
    });
    expect(logs).toContain(
      'posts: @karma fetched=2, enqueued=2, dedupSkipped=0',
    );
    expect(w.runner.closed()).toBe(true);
  });

  it('counts dedup skips and honours --queue', async () => {
    const runner = w.deps.runner();
    vi.spyOn(runner, 'enqueue').mockReturnValue(-1);
    await runXPoller(['karma', '--queue', 'q'], options(), w.deps);
    expect(logs).toContain(
      'posts: @karma fetched=2, enqueued=0, dedupSkipped=2',
    );
  });

  it('logs skipped handles, empty results and API errors without failing', async () => {
    await runXPoller(['ghost'], options(), w.deps);
    expect(logs).toContain('[skip] @ghost: not in integrations.x.accounts');
    await runXPoller([], options(vi.fn(() => Promise.resolve([]))), w.deps);
    expect(logs).toContain('posts: no items returned for @karma');
    await runXPoller(
      [],
      options(vi.fn(() => Promise.reject(new Error('rate')))),
      w.deps,
    );
    expect(errors).toContain('posts: API error for @karma: rate');
    await runXPoller([], options(), { ...w.deps, accounts: {} });
    expect(
      logs.some((l) => l.startsWith('[skip] no X accounts configured')),
    ).toBe(true);
  });
});

describe('pollFeeds', () => {
  const feedClient = (data: unknown[]) => ({
    users: {
      getByUsername: () => Promise.resolve({ data: { id: 'u1' } }),
      getTimeline: () => Promise.resolve({ data }),
    },
  });

  it('writes new feed items, skips known ones and prunes old files', async () => {
    w = xWorld(
      feedClient([
        { id: '1', text: 'a' },
        { id: '2', text: 'b' },
      ]),
    );
    const feedDir = path.join(w.accountDir, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    fs.writeFileSync(path.join(feedDir, '2.json'), '{}');
    const old = path.join(feedDir, 'old.json');
    fs.writeFileSync(old, '{}');
    const past = (X_NOW.getTime() - (PRUNE_DAYS + 1) * 86_400_000) / 1000;
    fs.utimesSync(old, past, past);
    await pollFeeds([], w.deps);
    const item = JSON.parse(
      fs.readFileSync(path.join(feedDir, '1.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(item).toMatchObject({
      id: '1',
      _feedSource: 'timeline',
      _ingestedAt: X_NOW.toISOString(),
    });
    expect(fs.existsSync(old)).toBe(false);
    expect(logs).toContain('feed: @karma fetched=2 (new=1, dedup=1), pruned=1');
  });

  it('fails after trying every handle when one fails', async () => {
    const deps = {
      ...w.deps,
      withClient: () => Promise.reject(new Error('down')),
    };
    await expect(pollFeeds([], deps)).rejects.toThrow(
      'poll-feed failed for @karma',
    );
    expect(errors).toContain('poll-feed: @karma failed: down');
  });
});

describe('runXQueueAction', () => {
  const options = (
    actionFn: XQueueActionOptions['actionFn'] = vi.fn(() =>
      Promise.resolve(true),
    ),
  ) => ({
    scriptName: 'x/like',
    queuePrefix: 'x-like',
    actionLabel: 'like',
    successLabel: 'liked',
    actionFn,
  });

  it('acts on each queued tweet and settles the items', async () => {
    const r = w.runner.client;
    r.enqueue('x-like-karma', { tweetId: 't1' });
    r.enqueue('x-like-karma', { tweetId: 't2' });
    r.enqueue('x-like-karma', { tweetId: 't3' });
    const opts = options((_c, _h, id) => Promise.resolve(id !== 't2'));
    await runXQueueAction(['karma', '--maxItems', '2'], opts, w.deps);
    const q = w.runner.queues.get('x-like-karma') ?? [];
    expect(q.map((i) => i.status)).toEqual(['done', 'failed', 'pending']);
    expect(logs).toContain('like: @karma liked=1, failed=1');
    expect(w.runner.closed()).toBe(true);
  });

  it('drains the --queue override', async () => {
    w.runner.client.enqueue('custom', { tweetId: 't1' });
    await runXQueueAction(['karma', '--queue', 'custom'], options(), w.deps);
    expect(w.runner.queues.get('custom')?.[0]?.status).toBe('done');
  });
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
    const create = vi.fn((body: Record<string, unknown>) =>
      Promise.resolve({ data: { id: `p-${String(body.text)}` } }),
    );
    w = xWorld({ posts: { create } });
    enqueue('a.json', { text: 'hello' });
    enqueue('b.json', { text: 're', type: 'reply', replyToId: '9' });
    enqueue('c.json', { text: 'qt', type: 'quote', quoteId: '8' });
    enqueue('d.json', { text: 'later', targetTime: '2027-01-01T00:00:00Z' });
    enqueue('e.json', '{bad');
    enqueue('notes.txt', 'x');
    await postQueue('karma', w.deps);
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
    await postQueue('karma', deps);
    const item = JSON.parse(
      fs.readFileSync(path.join(queueDir(), 'a.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(item).toMatchObject({ retries: MAX_RETRIES - 1, lastError: 'nope' });
    expect(logs).toContain(
      `post: retry ${String(MAX_RETRIES - 1)}/${String(MAX_RETRIES)} for a.json`,
    );
    await postQueue('karma', deps);
    expect(fs.existsSync(path.join(queueDir(), 'failed', 'a.json'))).toBe(true);
    expect(logs).toContain(
      `post: FAILED after ${String(MAX_RETRIES)} retries: a.json`,
    );
  });

  it('names a tweet without an id after the clock, and fails for an unconfigured account', async () => {
    w = xWorld({ posts: { create: () => Promise.resolve({}) } });
    enqueue('a.json', { text: 'x' });
    await postQueue('karma', w.deps);
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

describe('refreshXToken', () => {
  it('reports the new token and where it was written', async () => {
    const refresh = vi.fn(() =>
      Promise.resolve({ accessToken: 'a', refreshToken: 'r', expiresIn: 60 }),
    );
    await refreshXToken('karma', { ...w.deps, refresh });
    expect(logs).toContain(
      'Token refreshed for @karma. Expires in: 60 seconds',
    );
    expect(logs).toContain(
      `Written to: ${path.join(w.deps.oauthDir, 'x-karma-oauth2.json')}`,
    );
  });

  it('stops quietly when the refresh skips', async () => {
    await refreshXToken('karma', w.deps);
    expect(logs).toEqual(['Refreshing X OAuth 2.0 token for @karma...']);
  });
});

describe('drainXQueues', () => {
  it('flushes each poll queue to its subdirectory and settles every item', () => {
    const r = w.runner.client;
    r.enqueue('x-posts-karma', { id: '1', raw: { id: '1', text: 'raw' } });
    r.enqueue('x-mentions-karma', { id: '2', text: 'plain' });
    r.enqueue('x-feed-karma', { text: 'no id' });
    drainXQueues(['--maxItems', '10'], w.deps);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(w.accountDir, 'posts', '1.json'), 'utf8'),
      ),
    ).toEqual({ id: '1', text: 'raw' });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(w.accountDir, 'mentions', '2.json'), 'utf8'),
      ),
    ).toEqual({ id: '2', text: 'plain' });
    expect(
      [...w.runner.queues.values()].flat().every((i) => i.status === 'done'),
    ).toBe(true);
    expect(logs).toContain('x-feed-karma: processed=1');
    expect(logs).toContain('drain: total processed=2');
    expect(w.runner.closed()).toBe(true);
  });
});

describe('xJobDeps', () => {
  it('reads accounts and the OAuth directory from config', () => {
    const live = xJobDeps();
    expect(live.accounts).toEqual({});
    expect(path.basename(live.oauthDir)).toBe('oauth');
    expect(live.now()).toBeInstanceOf(Date);
  });
});
