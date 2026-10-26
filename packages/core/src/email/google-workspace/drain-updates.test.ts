/**
 * Tests for the label-change drain with injected gog and runner: plans,
 * label pre-creation, rate limiting, cache provenance and failures.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { constants } from '../../lib/constants.js';
import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import { createOrUpdateCache, loadCache } from '../email-cache.js';
import {
  drainUpdates,
  type DrainUpdatesDeps,
  drainUpdatesDeps,
  MAX_CALLS_PER_MINUTE,
} from './drain-updates.js';
import { EMAIL_UPDATES_QUEUE } from './label-actions.js';

const baseDir = useTempConfig();
const ACCOUNT = 'me@example.com';
let runner: ReturnType<typeof fakeRunnerClient>;
let gogCalls: string[][];
let sleeps: number[];

const deps = (
  answer: (args: string[]) => string = () => '',
  over: Partial<DrainUpdatesDeps> = {},
): DrainUpdatesDeps => ({
  reportOnly: false,
  accountReportOnly: () => false,
  gmailAccounts: 1,
  gog: (args) => {
    gogCalls.push(args);
    return answer(args);
  },
  runner: () => runner.client,
  eventsDir: path.join(baseDir(), 'events'),
  now: () => '2026-07-01T00:00:00.000Z',
  sleep: (ms) => sleeps.push(ms),
  ...over,
});

const enqueue = (payload: Record<string, unknown>) =>
  runner.client.enqueue(EMAIL_UPDATES_QUEUE, {
    account: ACCOUNT,
    threadId: 't1',
    messageId: 'm1',
    source: 'triage',
    ...payload,
  });

beforeEach(() => {
  // gog has an OAuth client, so planDrain runs when accounts exist.
  const client = constants().GOG_CLIENT_PATH;
  fs.mkdirSync(path.dirname(client), { recursive: true });
  fs.writeFileSync(client, '{}');
  runner = fakeRunnerClient();
  gogCalls = [];
  sleeps = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('drainUpdates', () => {
  it('leaves the queue alone when report-only, and skips without Gmail accounts', () => {
    enqueue({ action: 'archive' });
    drainUpdates(deps(undefined, { reportOnly: true }));
    drainUpdates(deps(undefined, { gmailAccounts: 0 }));
    expect(console.log).toHaveBeenCalledWith(
      '[report-only] emailConfig.reportOnly is true: no Gmail changes applied; queue left untouched',
    );
    expect(console.log).toHaveBeenCalledWith(
      '[skip] No Gmail accounts configured',
    );
    expect(runner.queues.get(EMAIL_UPDATES_QUEUE)?.[0]?.status).toBe('pending');
  });

  it('reports an empty queue', () => {
    drainUpdates(deps());
    expect(console.log).toHaveBeenCalledWith('Queue is empty');
    expect(runner.closed()).toBe(true);
  });

  it('creates missing labels once, applies changes, records provenance and rate-limits', () => {
    createOrUpdateCache({
      account: ACCOUNT,
      threadId: 't1',
      subject: 's',
      participants: [],
      messages: {
        m1: {
          messageId: 'm1',
          from: '',
          to: '',
          cc: '',
          date: null,
          internalDateMs: 0,
          labels: ['INBOX'],
          snippet: '',
          hasAttachments: false,
          attachments: [],
        },
      },
      provenance: [],
    });
    enqueue({ action: 'addLabel', label: 'Jeeves/Vendor' });
    enqueue({ action: 'addLabel', label: 'Jeeves/Vendor' });
    enqueue({ action: 'archive', threadId: 'no-cache' });
    drainUpdates(
      deps((args) =>
        args[1] === 'labels' && args[2] === 'list'
          ? JSON.stringify({ labels: [{ name: 'INBOX' }] })
          : '',
      ),
    );
    const creates = gogCalls.filter((c) => c[2] === 'create');
    expect(creates).toEqual([
      ['gmail', 'labels', 'create', 'Jeeves/Vendor', '--account', ACCOUNT],
    ]);
    expect(
      (runner.queues.get(EMAIL_UPDATES_QUEUE) ?? []).map((i) => i.status),
    ).toEqual(['done', 'done', 'done']);
    const cache = loadCache(ACCOUNT, 't1');
    expect(cache?.messages?.m1?.labels).toEqual(['INBOX', 'Jeeves/Vendor']);
    expect(cache?.provenance[0]).toMatchObject({
      field: 'labels',
      value: '+Jeeves/Vendor',
      by: 'jeeves',
      source: 'triage',
    });
    expect(sleeps).toEqual([
      60000 / MAX_CALLS_PER_MINUTE,
      60000 / MAX_CALLS_PER_MINUTE,
    ]);
    const run = JSON.parse(
      fs
        .readFileSync(path.join(baseDir(), 'events', '_runs.jsonl'), 'utf8')
        .trim(),
    ) as Record<string, unknown>;
    expect(run).toEqual({
      at: '2026-07-01T00:00:00.000Z',
      kind: 'drain_updates',
      processed: 3,
      succeeded: 3,
      failed: 0,
      dropped: 0,
    });
  });

  it("drops a report-only account's queued items without calling gog, and applies the others", () => {
    const SHARED = 'shared@example.com';
    enqueue({ account: SHARED, action: 'addLabel', label: 'Receipts' });
    enqueue({ account: SHARED, action: 'archive' });
    enqueue({ action: 'archive' });
    drainUpdates(deps(undefined, { accountReportOnly: (a) => a === SHARED }));
    expect(gogCalls.every((c) => c.at(-1) === ACCOUNT)).toBe(true);
    expect(gogCalls).toHaveLength(1);
    expect(
      (runner.queues.get(EMAIL_UPDATES_QUEUE) ?? []).map((i) => i.status),
    ).toEqual(['done', 'done', 'done']);
    expect(console.log).toHaveBeenCalledWith(
      `[report-only] dropped addLabel Receipts on ${SHARED} thread t1 (account is report-only)`,
    );
    expect(console.log).toHaveBeenCalledWith(
      `[report-only] dropped archive on ${SHARED} thread t1 (account is report-only)`,
    );
    const run = JSON.parse(
      fs
        .readFileSync(path.join(baseDir(), 'events', '_runs.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .at(-1) ?? '',
    ) as Record<string, unknown>;
    expect(run).toMatchObject({ processed: 1, succeeded: 1, dropped: 2 });
    expect(sleeps).toEqual([]);
  });

  it('drops every item when all belong to report-only accounts', () => {
    enqueue({ action: 'archive' });
    drainUpdates(deps(undefined, { accountReportOnly: () => true }));
    expect(gogCalls).toEqual([]);
    expect(runner.queues.get(EMAIL_UPDATES_QUEUE)?.[0]?.status).toBe('done');
  });

  it('logs a failed label check and fails entries whose modify fails', () => {
    enqueue({ action: 'addLabel', label: 'X' });
    drainUpdates(
      deps(() => {
        throw new Error('rate limited');
      }),
    );
    expect(console.error).toHaveBeenCalledWith(
      'Failed label check "X" for me@example.com:',
      'rate limited',
    );
    expect(runner.queues.get(EMAIL_UPDATES_QUEUE)?.[0]).toMatchObject({
      status: 'failed',
      error: 'rate limited',
    });
  });
});

describe('drainUpdatesDeps', () => {
  it('reads report-only and the accounts from config', () => {
    const live = drainUpdatesDeps();
    expect(live.reportOnly).toBe(true);
    expect(live.accountReportOnly('anyone@example.com')).toBe(true);
    expect(live.gmailAccounts).toBe(0);
  });
});
