/**
 * Tests for the X runnables' logic with injected collaborators: the
 * pollers, the feed poller, the queue actions, the token refresh and the
 * queue drain. The post publisher is tested in `post.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ArgSpec, parseRunnableArgs } from '../lib/args.js';
import { drainXQueues, drainXQueuesFlags } from './drain-queues.js';
import { pollXFlags, runXPoller } from './lib/poll-x-items.js';
import {
  runXQueueAction,
  xQueueActionFlags,
  type XQueueActionOptions,
} from './lib/run-x-queue-action.js';
import type { XClient, XTweetData } from './lib/x-client.js';
import { xJobDeps } from './lib/x-deps.js';
import {
  captureConsole,
  unstubbedXClient,
  X_NOW,
  type XWorld,
  xWorld,
} from './lib/x-deps.test-helper.js';
import { pollFeeds, PRUNE_DAYS } from './poll-feed.js';
import { refreshXToken } from './refresh-token.js';

const flagsOf = <S extends ArgSpec>(args: string[], spec: S) =>
  parseRunnableArgs(args, spec);

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
  ({ logs, errors } = captureConsole());
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
    await runXPoller(
      ['--count', '5'],
      flagsOf(['--count', '5'], pollXFlags),
      opts,
      w.deps,
    );
    expect(opts.pollFn).toHaveBeenCalledWith(w.client, 'example', {
      maxResults: 5,
    });
    const queued = w.runner.queues.get('x-posts-example') ?? [];
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
      'posts: @example fetched=2, enqueued=2, dedupSkipped=0',
    );
    expect(w.runner.closed()).toBe(true);
  });

  it('counts dedup skips and honours --queue', async () => {
    const runner = w.deps.runner();
    vi.spyOn(runner, 'enqueue').mockReturnValue(-1);
    await runXPoller(
      ['example', '--queue', 'q'],
      flagsOf(['example', '--queue', 'q'], pollXFlags),
      options(),
      w.deps,
    );
    expect(logs).toContain(
      'posts: @example fetched=2, enqueued=0, dedupSkipped=2',
    );
  });

  it('logs skipped handles, empty results and API errors without failing', async () => {
    await runXPoller(
      ['ghost'],
      flagsOf(['ghost'], pollXFlags),
      options(),
      w.deps,
    );
    expect(logs).toContain('[skip] @ghost: not in integrations.x.accounts');
    await runXPoller(
      [],
      flagsOf([], pollXFlags),
      options(vi.fn(() => Promise.resolve([]))),
      w.deps,
    );
    expect(logs).toContain('posts: no items returned for @example');
    await runXPoller(
      [],
      flagsOf([], pollXFlags),
      options(vi.fn(() => Promise.reject(new Error('rate')))),
      w.deps,
    );
    expect(errors).toContain('posts: API error for @example: rate');
    await runXPoller([], flagsOf([], pollXFlags), options(), {
      ...w.deps,
      accounts: {},
    });
    expect(
      logs.some((l) => l.startsWith('[skip] no X accounts configured')),
    ).toBe(true);
  });
});

describe('pollFeeds', () => {
  const feedClient = (data: XTweetData[]): XClient => ({
    ...unstubbedXClient(),
    users: {
      ...unstubbedXClient().users,
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
    expect(logs).toContain(
      'feed: @example fetched=2 (new=1, dedup=1), pruned=1',
    );
  });

  it('fails after trying every handle when one fails', async () => {
    const deps = {
      ...w.deps,
      withClient: () => Promise.reject(new Error('down')),
    };
    await expect(pollFeeds([], deps)).rejects.toThrow(
      'poll-feed failed for @example',
    );
    expect(errors).toContain('poll-feed: @example failed: down');
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
    r.enqueue('x-like-example', { tweetId: 't1' });
    r.enqueue('x-like-example', { tweetId: 't2' });
    r.enqueue('x-like-example', { tweetId: 't3' });
    const opts = options((_c, _h, id) => Promise.resolve(id !== 't2'));
    await runXQueueAction(
      ['example', '--maxItems', '2'],
      flagsOf(['example', '--maxItems', '2'], xQueueActionFlags),
      opts,
      w.deps,
    );
    const q = w.runner.queues.get('x-like-example') ?? [];
    expect(q.map((i) => i.status)).toEqual(['done', 'failed', 'pending']);
    expect(logs).toContain('like: @example liked=1, failed=1');
    expect(w.runner.closed()).toBe(true);
  });

  it('drains an empty handle queue without a handle', async () => {
    await runXQueueAction(
      [],
      flagsOf([], xQueueActionFlags),
      options(),
      w.deps,
    );
    expect(logs).toContain('like: @ liked=0, failed=0');
  });

  it('drains the --queue override', async () => {
    w.runner.client.enqueue('custom', { tweetId: 't1' });
    await runXQueueAction(
      ['example', '--queue', 'custom'],
      flagsOf(['example', '--queue', 'custom'], xQueueActionFlags),
      options(),
      w.deps,
    );
    expect(w.runner.queues.get('custom')?.[0]?.status).toBe('done');
  });
});

describe('refreshXToken', () => {
  it('reports the new token and where it was written', async () => {
    const refresh = vi.fn(() =>
      Promise.resolve({ accessToken: 'a', refreshToken: 'r', expiresIn: 60 }),
    );
    await refreshXToken('example', { ...w.deps, refresh });
    expect(logs).toContain(
      'Token refreshed for @example. Expires in: 60 seconds',
    );
    expect(logs).toContain(
      `Written to: ${path.join(w.deps.oauthDir, 'x-example-oauth2.json')}`,
    );
  });

  it('stops quietly when the refresh skips', async () => {
    await refreshXToken('example', w.deps);
    expect(logs).toEqual(['Refreshing X OAuth 2.0 token for @example...']);
  });
});

describe('drainXQueues', () => {
  it('flushes each poll queue to its subdirectory and settles every item', () => {
    const r = w.runner.client;
    r.enqueue('x-posts-example', { id: '1', raw: { id: '1', text: 'raw' } });
    r.enqueue('x-mentions-example', { id: '2', text: 'plain' });
    r.enqueue('x-feed-example', { text: 'no id' });
    drainXQueues(flagsOf(['--maxItems', '10'], drainXQueuesFlags), w.deps);
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
    expect(logs).toContain('x-feed-example: processed=1');
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
