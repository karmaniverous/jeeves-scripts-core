/**
 * Tests for apply-labels: pending-label rule, enqueue + labelApplied
 * recording, idempotency, filters (since, accounts, max), dry run and
 * reportOnly. State and queue are an in-memory runner store.
 */

import { describe, expect, it } from 'vitest';

import { setThreadState, type ThreadState } from '../email-state.js';
import {
  type ApplyLabelsClient,
  applyPendingLabels,
  pendingLabels,
} from './apply-labels.js';
import { EMAIL_UPDATES_QUEUE } from './label-actions.js';

/** In-memory runner store with insertion-ordered item keys. */
const memoryClient = () => {
  const items = new Map<string, string>();
  const queue: { name: string; payload: Record<string, unknown> }[] = [];
  const client: ApplyLabelsClient = {
    getItem: (ns, key, item) => items.get(`${ns}|${key}|${item}`) ?? null,
    setItem: (ns, key, item, value) =>
      void items.set(`${ns}|${key}|${item}`, value ?? ''),
    listItemKeys: (ns, key) =>
      [...items.keys()]
        .filter((k) => k.startsWith(`${ns}|${key}|`))
        .map((k) => k.slice(`${ns}|${key}|`.length)),
    enqueue: (name, payload) => {
      queue.push({ name, payload: payload as Record<string, unknown> });
      return queue.length;
    },
  };
  return { client, items, queue };
};

const A = 'me@example.com';
const B = 'ops@example.com';

const seed = (
  client: ApplyLabelsClient,
  account: string,
  threadId: string,
  state: ThreadState,
) => {
  setThreadState(client, account, threadId, state);
};

const read = (client: ApplyLabelsClient, account: string, id: string) =>
  JSON.parse(
    client.getItem('email', `${account}.seenThreadIds`, id) ?? 'null',
  ) as ThreadState;

describe('pendingLabels', () => {
  it('is the classification labels not yet in labelApplied', () => {
    expect(
      pendingLabels(
        {
          receiptCandidate: true,
          junkCandidate: true,
          bucket: 'clients',
          labelApplied: { junk: 'then' },
        },
        ['clients'],
      ),
    ).toEqual(['receipt', 'clients']);
  });

  it('ignores a bucket that is no longer configured, and empty state', () => {
    expect(pendingLabels({ bucket: 'old' }, ['clients'])).toEqual([]);
    expect(pendingLabels({}, [])).toEqual([]);
  });
});

describe('applyPendingLabels', () => {
  const base = { buckets: ['clients'], dryRun: false, reportOnly: false };

  it('enqueues pending labels, records them, and is idempotent', () => {
    const { client, queue } = memoryClient();
    seed(client, A, 't1', {
      receiptCandidate: true,
      bucket: 'clients',
      seenMessageIds: { m1: 'x' },
      labels: ['INBOX'],
    });
    seed(client, A, 't2', {
      receiptCandidate: true,
      labelApplied: { receipt: 'then' },
    });

    const r = applyPendingLabels({ ...base, client, accounts: [A] });
    expect(r).toMatchObject({ dryRun: false, labels: 2, truncated: false });
    expect(r.accounts).toEqual([
      {
        account: A,
        scanned: 2,
        threads: 1,
        labels: { receipt: 1, clients: 1 },
      },
    ]);
    expect(queue.map((q) => q.name)).toEqual([
      EMAIL_UPDATES_QUEUE,
      EMAIL_UPDATES_QUEUE,
    ]);
    expect(queue[0]?.payload).toMatchObject({
      account: A,
      threadId: 't1',
      messageId: 'm1',
      action: 'addLabel',
      label: 'receipt',
      source: 'apply-labels',
    });
    const t1 = read(client, A, 't1');
    expect(Object.keys(t1.labelApplied ?? {})).toEqual(['receipt', 'clients']);
    expect(t1.labels).toEqual(['INBOX']);

    const again = applyPendingLabels({ ...base, client, accounts: [A] });
    expect(again.labels).toBe(0);
    expect(queue).toHaveLength(2);
  });

  it('uses the thread id when no message ids are recorded', () => {
    const { client, queue } = memoryClient();
    seed(client, A, 't1', { junkCandidate: true });
    applyPendingLabels({ ...base, client, accounts: [A] });
    expect(queue[0]?.payload).toMatchObject({ messageId: 't1', label: 'junk' });
  });

  it('a dry run plans the same labels but changes nothing', () => {
    const { client, queue, items } = memoryClient();
    seed(client, A, 't1', { receiptCandidate: true });
    const before = new Map(items);
    const r = applyPendingLabels({
      ...base,
      client,
      accounts: [A],
      dryRun: true,
    });
    expect(r).toMatchObject({ dryRun: true, labels: 1 });
    expect(queue).toEqual([]);
    expect(items).toEqual(before);
  });

  it('reportOnly is always a dry run', () => {
    const { client, queue } = memoryClient();
    seed(client, A, 't1', { receiptCandidate: true });
    const r = applyPendingLabels({
      ...base,
      client,
      accounts: [A],
      reportOnly: true,
    });
    expect(r).toMatchObject({ dryRun: true, labels: 1 });
    expect(queue).toEqual([]);
    expect(read(client, A, 't1').labelApplied).toBeUndefined();
  });

  it('since keeps threads dated (else last seen) on or after it', () => {
    const { client, queue } = memoryClient();
    seed(client, A, 'old', { receiptCandidate: true, date: '2026-01-01' });
    seed(client, A, 'new', { receiptCandidate: true, date: '2026-10-02' });
    seed(client, A, 'seen', {
      receiptCandidate: true,
      seenAt: '2026-10-05T00:00:00Z',
    });
    seed(client, A, 'undated', { receiptCandidate: true });
    applyPendingLabels({
      ...base,
      client,
      accounts: [A],
      since: new Date('2026-10-01T00:00:00Z'),
    });
    expect(queue.map((q) => q.payload.threadId)).toEqual(['new', 'seen']);
  });

  it('covers only the accounts given', () => {
    const { client, queue } = memoryClient();
    seed(client, A, 't1', { receiptCandidate: true });
    seed(client, B, 't2', { receiptCandidate: true });
    const r = applyPendingLabels({ ...base, client, accounts: [B] });
    expect(r.accounts.map((a) => a.account)).toEqual([B]);
    expect(queue.map((q) => q.payload.threadId)).toEqual(['t2']);
  });

  it('stops at maxThreads across accounts and resumes on the next run', () => {
    const { client, queue } = memoryClient();
    seed(client, A, 't1', { receiptCandidate: true });
    seed(client, A, 't2', { receiptCandidate: true });
    seed(client, B, 't3', { receiptCandidate: true });

    const first = applyPendingLabels({
      ...base,
      client,
      accounts: [A, B],
      maxThreads: 1,
    });
    expect(first).toMatchObject({ truncated: true, labels: 1 });
    expect(first.accounts.map((a) => a.account)).toEqual([A]);

    const second = applyPendingLabels({
      ...base,
      client,
      accounts: [A, B],
      maxThreads: 5,
    });
    expect(second).toMatchObject({ truncated: false, labels: 2 });
    expect(queue.map((q) => q.payload.threadId)).toEqual(['t1', 't2', 't3']);
  });
});
