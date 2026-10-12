/**
 * Tests for the Gmail body download with injected gog and runner: the
 * full-thread path, the per-message path, dedup, failures and the run log.
 * Thread caches land in a temp archive (`useTempConfig`).
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import { getThreadsPath } from '../email-cache.js';
import {
  type DownloadDeps,
  downloadDeps,
  downloadThreads,
} from './download.js';

const baseDir = useTempConfig();
const ACCOUNT = 'me@example.com';
const NOW = '2026-10-04T00:00:00.000Z';

const message = (id: string) => ({
  id,
  snippet: `snippet ${id}`,
  internalDate: '1790000000000',
  labelIds: ['INBOX'],
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'Subject', value: `Subject ${id}` },
      { name: 'From', value: 'a@example.com' },
    ],
    body: { data: Buffer.from(`Body ${id}`).toString('base64url') },
  },
});

let runner: ReturnType<typeof fakeRunnerClient>;
let gogCalls: string[][];

const deps = (
  answer: (args: string[]) => string | null,
  over: Partial<DownloadDeps> = {},
): DownloadDeps => ({
  hasGmail: () => true,
  gog: (args) => {
    gogCalls.push(args);
    const out = answer(args);
    if (out === null) return null as unknown as string;
    return out;
  },
  runner: () => runner.client,
  eventsDir: path.join(baseDir(), 'events'),
  now: () => NOW,
  sleep: () => undefined,
  ...over,
});

const queue = (threadId: string) =>
  runner.client.enqueue('email-pending', { account: ACCOUNT, threadId });
const statuses = () =>
  (runner.queues.get('email-pending') ?? []).map((i) => i.status);
const exists = (threadId: string, messageId: string) =>
  fs.existsSync(
    path.join(getThreadsPath(ACCOUNT, threadId), `${messageId}.json`),
  );
const lastRun = () =>
  JSON.parse(
    fs
      .readFileSync(
        path.join(baseDir(), 'events', '_runs-download.jsonl'),
        'utf8',
      )
      .trim()
      .split('\n')
      .at(-1) ?? '{}',
  ) as Record<string, unknown>;

beforeEach(() => {
  runner = fakeRunnerClient();
  gogCalls = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadThreads', () => {
  it('skips without Gmail accounts', () => {
    downloadThreads(deps(() => '', { hasGmail: () => false }));
    expect(console.log).toHaveBeenCalledWith(
      '[skip] No Gmail accounts configured',
    );
    expect(runner.closed()).toBe(false);
  });

  it('fetches an uncached thread whole, saves new messages and records the messages map', () => {
    const dir = getThreadsPath(ACCOUNT, 't1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'm0.json'), '{}');
    fs.writeFileSync(
      path.join(dir, 'thread.json'),
      JSON.stringify({ subject: 'kept' }),
    );
    queue('t1');
    downloadThreads(
      deps(() =>
        JSON.stringify({
          thread: { messages: [message('m0'), message('m1')] },
        }),
      ),
    );
    expect(gogCalls[0]).toEqual([
      'gmail',
      'thread',
      't1',
      '--json',
      '--account',
      ACCOUNT,
    ]);
    expect(exists('t1', 'm1')).toBe(true);
    const thread = JSON.parse(
      fs.readFileSync(path.join(dir, 'thread.json'), 'utf8'),
    ) as {
      subject: string;
      messages: Record<string, unknown>;
    };
    expect(thread.subject).toBe('kept');
    expect(Object.keys(thread.messages).sort()).toEqual(['m0', 'm1']);
    expect(statuses()).toEqual(['done']);
    expect(lastRun()).toMatchObject({
      at: NOW,
      kind: 'download',
      threadsDequeued: 1,
      processedThreads: 1,
      totalMessages: 2,
      downloadedMessages: 1,
      skippedMessages: 1,
    });
  });

  it('downloads each cached message id not on disk', () => {
    const dir = getThreadsPath(ACCOUNT, 't2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'thread.json'),
      JSON.stringify({ messages: { a: {}, b: {}, c: {} } }),
    );
    queue('t2');
    downloadThreads(
      deps((args) => {
        if (args[2] === 'a') return JSON.stringify({ message: message('a') });
        if (args[2] === 'b') return JSON.stringify(message('b'));
        return null;
      }),
    );
    expect(exists('t2', 'a') && exists('t2', 'b')).toBe(true);
    expect(statuses()).toEqual(['done']);
    expect(lastRun()).toMatchObject({
      downloadedMessages: 2,
      failedMessages: 1,
    });
  });

  it('fails a thread when nothing downloads', () => {
    const dir = getThreadsPath(ACCOUNT, 't3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'thread.json'),
      JSON.stringify({ messages: { x: {} } }),
    );
    queue('t3');
    downloadThreads(
      deps(() => {
        throw new Error('quota');
      }),
    );
    expect(runner.queues.get('email-pending')?.[0]).toMatchObject({
      status: 'failed',
      error: 'Failed to download any messages (1 failed)',
    });
    expect(console.error).toHaveBeenCalledWith('Failed x:', 'quota');
  });

  it.each([
    [
      () => {
        throw new Error('boom');
      },
      'boom',
    ],
    [() => null, 'gog thread returned null'],
    [
      () => JSON.stringify({ thread: { messages: [] } }),
      'thread response had no messages',
    ],
  ])('fails an uncached thread whose fetch fails (%#)', (answer, reason) => {
    queue(`u-${reason}`);
    downloadThreads(deps(answer));
    expect(runner.queues.get('email-pending')?.[0]).toMatchObject({
      status: 'failed',
      error: reason,
    });
    expect(lastRun()).toMatchObject({ failedThreads: 1 });
  });

  it('fails a thread whose cache is unreadable', () => {
    const dir = getThreadsPath(ACCOUNT, 't4');
    fs.mkdirSync(path.join(dir, 'thread.json'), { recursive: true });
    queue('t4');
    downloadThreads(deps(() => ''));
    expect(statuses()).toEqual(['failed']);
  });
});

describe('downloadDeps', () => {
  it('skips with no Gmail accounts in the test config', () => {
    expect(downloadDeps().hasGmail()).toBe(false);
    expect(downloadDeps().eventsDir).toContain(baseDir());
  });
});
