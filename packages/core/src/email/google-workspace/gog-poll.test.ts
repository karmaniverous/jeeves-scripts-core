/**
 * Tests for gog-poll: thread update detection, per-thread events, label
 * enqueue on classification change, state, deep-fetch and the run summary.
 * gog, triage, label actions and the deep fetch are mocked; state is an
 * in-memory runner store; events go to a temp dir.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailStoreClient } from '../email-state.js';
import type { ThreadSummary } from './gmail-search.js';

const mocks = vi.hoisted(() => ({
  dir: '',
  threads: [] as unknown[],
  bucket: null as string | null,
  important: true,
  enqueueLabelActions: vi.fn(() => ({
    applied: { receipt: 'now' },
    enqueued: 1,
  })),
  fetchThreadMetadata: vi.fn(() => ({ newMessages: 2 })),
  gogWithRetry: vi.fn(() => '{}'),
}));

vi.mock('../../lib/constants.js', () => ({
  constants: () => ({ EMAIL_EVENTS_DIR: mocks.dir }),
}));
vi.mock('../../lib/gog.js', () => ({ gogWithRetry: mocks.gogWithRetry }));
vi.mock('./gmail-search.js', () => ({
  searchArgs: (account: string, query: string, max: number) => [
    'search',
    account,
    query,
    String(max),
  ],
  parseSearchPage: () => ({ threads: mocks.threads }),
}));
vi.mock('./email-triage.js', () => ({
  classifyCandidates: () => ({ receiptCandidate: true, junkCandidate: false }),
  classifyBucket: () => mocks.bucket,
  computeLabelsToApply: () => ['receipt'],
  looksImportantBySummary: () => mocks.important,
}));
vi.mock('./label-actions.js', () => ({
  enqueueLabelActions: mocks.enqueueLabelActions,
}));
vi.mock('./email-fetch.js', () => ({
  fetchThreadMetadata: mocks.fetchThreadMetadata,
}));

const { isThreadUpdate, pollGogAccount, pollThread } =
  await import('./gog-poll.js');

/** In-memory runner store. */
const memoryClient = () => {
  const items = new Map<string, string>();
  const state = new Map<string, string>();
  const queue: { name: string; item: unknown }[] = [];
  const client = {
    getItem: (ns: string, c: string, k: string) =>
      items.get(`${ns}/${c}/${k}`) ?? null,
    setItem: (ns: string, c: string, k: string, v: string) =>
      void items.set(`${ns}/${c}/${k}`, v),
    getState: (ns: string, k: string) => state.get(`${ns}/${k}`) ?? null,
    setState: (ns: string, k: string, v: string) =>
      void state.set(`${ns}/${k}`, v),
    enqueue: (name: string, item: unknown) => void queue.push({ name, item }),
  } as unknown as EmailStoreClient;
  return { client, items, state };
};

const thread = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  threadId: 't1',
  subject: 'Receipt',
  snippet: 'Thanks',
  from: 'shop@x',
  to: 'me@x',
  date: '2026-10-01',
  messageCount: 1,
  labels: ['INBOX'],
  ...over,
});

const events = (file: string) =>
  fs
    .readFileSync(path.join(mocks.dir, file), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

beforeEach(() => {
  mocks.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-poll-'));
  mocks.bucket = null;
  mocks.important = true;
});

afterEach(() => {
  fs.rmSync(mocks.dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('isThreadUpdate', () => {
  it('is an update when the message count grew or the date changed', () => {
    const prev = { messageCount: 2, date: 'a' };
    expect(isThreadUpdate(null, { messageCount: 9, date: 'b' })).toBe(false);
    expect(isThreadUpdate(prev, { messageCount: 3, date: 'a' })).toBe(true);
    expect(isThreadUpdate(prev, { messageCount: 2, date: 'b' })).toBe(true);
    expect(isThreadUpdate(prev, { messageCount: 2, date: 'a' })).toBe(false);
    expect(isThreadUpdate(prev, { messageCount: null, date: null })).toBe(
      false,
    );
  });
});

describe('pollThread', () => {
  const ctx = (client: EmailStoreClient, reportOnly = false) => ({
    account: 'me@x',
    client,
    reportOnly,
    query: 'in:anywhere',
    max: 100,
  });

  it('logs, labels, records and deep-fetches a new thread', () => {
    const { client, items } = memoryClient();
    expect(pollThread(ctx(client), thread())).toEqual({
      isNew: true,
      isUpdate: false,
      labelsEnqueued: 1,
      deepFetched: true,
      newMessages: 2,
    });
    expect(events('me@x.jsonl')).toEqual([
      expect.objectContaining({
        kind: 'thread',
        threadId: 't1',
        source: 'poll',
      }),
    ]);
    expect(mocks.enqueueLabelActions).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        messageId: 't1',
        labels: ['receipt'],
        reportOnly: false,
      }),
    );
    expect(mocks.fetchThreadMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 't1', receiptCandidate: true }),
    );
    expect(JSON.parse([...items.values()][0] ?? '')).toMatchObject({
      messageCount: 1,
      receiptCandidate: true,
      labelApplied: { receipt: 'now' },
    });
  });

  it('does nothing more for an unchanged known thread', () => {
    const { client } = memoryClient();
    pollThread(ctx(client), thread());
    vi.clearAllMocks();
    expect(pollThread(ctx(client), thread())).toEqual({
      isNew: false,
      isUpdate: false,
      labelsEnqueued: 0,
      deepFetched: false,
      newMessages: 0,
    });
    expect(mocks.enqueueLabelActions).not.toHaveBeenCalled();
    expect(mocks.fetchThreadMetadata).not.toHaveBeenCalled();
  });

  it('logs an update with the previous values and re-labels on a new bucket', () => {
    const { client } = memoryClient();
    pollThread(ctx(client), thread());
    mocks.bucket = 'finance';
    mocks.important = false;
    const r = pollThread(ctx(client, true), thread({ messageCount: 2 }));
    expect(r).toMatchObject({
      isUpdate: true,
      labelsEnqueued: 1,
      deepFetched: false,
    });
    expect(events('me@x.jsonl')[1]).toMatchObject({
      kind: 'thread_update',
      prev: { messageCount: 1, date: '2026-10-01' },
      bucket: 'finance',
    });
    expect(mocks.enqueueLabelActions).toHaveBeenLastCalledWith(
      client,
      expect.objectContaining({ reportOnly: true }),
    );
  });
});

describe('pollGogAccount', () => {
  it('searches, polls every thread and appends the run summary', () => {
    const { client } = memoryClient();
    mocks.threads = [thread(), thread({ threadId: 't2' })];
    pollGogAccount({
      account: 'me@x',
      client,
      reportOnly: false,
      query: 'in:anywhere',
      max: 100,
    });
    expect(mocks.gogWithRetry).toHaveBeenCalledWith(
      ['search', 'me@x', 'in:anywhere', '100'],
      { retries: 2, backoffMs: 5000 },
    );
    expect(events('_runs-me@x.jsonl')).toEqual([
      expect.objectContaining({
        kind: 'poll',
        account: 'me@x',
        fetched: 2,
        new: 2,
        updated: 0,
        deepFetchedThreads: 2,
        newMessages: 4,
        labelsEnqueued: 2,
        reportOnly: false,
      }),
    ]);
  });
});
