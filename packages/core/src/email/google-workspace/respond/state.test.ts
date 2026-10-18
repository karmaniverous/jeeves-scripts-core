import { describe, expect, it, vi } from 'vitest';

import {
  getMessageState,
  getThreadReplyTimestamps,
  isPermanentlyHandled,
  MAX_ATTEMPTS,
  recordThreadReply,
  RESPOND_NAMESPACE,
  setMessageState,
  threadReplyCountSince,
} from './state.js';

function fakeClient() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((ns: string, key: string, itemKey: string) => {
      return store.get(`${ns}|${key}|${itemKey}`) ?? null;
    }),
    setItem: vi.fn(
      (ns: string, key: string, itemKey: string, value?: string) => {
        store.set(`${ns}|${key}|${itemKey}`, value ?? '');
      },
    ),
  };
}

describe('getMessageState / setMessageState', () => {
  it('returns null when nothing is stored', () => {
    const client = fakeClient();
    expect(getMessageState(client, 'm1')).toBeNull();
  });

  it('round-trips a stored message state', () => {
    const client = fakeClient();
    const state = {
      status: 'replied' as const,
      attempts: 1,
      at: '2026-10-13T00:00:00.000Z',
      threadId: 't1',
    };
    setMessageState(client, 'm1', state);
    expect(getMessageState(client, 'm1')).toEqual(state);
    expect(client.setItem).toHaveBeenCalledWith(
      RESPOND_NAMESPACE,
      'messages',
      'm1',
      JSON.stringify(state),
    );
  });
});

describe('getMessageState validation', () => {
  it('throws on malformed stored state instead of treating it as unhandled', () => {
    const client = fakeClient();
    client.store.set(
      'email-respond|messages|m1',
      JSON.stringify({ status: 'sent', attempts: 'x' }),
    );
    expect(() => getMessageState(client, 'm1')).toThrow(
      'email-respond state for message m1: unexpected shape',
    );
  });

  it('throws on stored state that is not JSON', () => {
    const client = fakeClient();
    client.store.set('email-respond|messages|m1', '{oops');
    expect(() => getMessageState(client, 'm1')).toThrow('output is not JSON');
  });
});

describe('isPermanentlyHandled', () => {
  it('is false for no recorded state', () => {
    expect(isPermanentlyHandled(null)).toBe(false);
  });

  it('is true once replied', () => {
    expect(
      isPermanentlyHandled({
        status: 'replied',
        attempts: 1,
        at: 'x',
        threadId: 't',
      }),
    ).toBe(true);
  });

  it('is true once skipped (qualification failures are permanent)', () => {
    expect(
      isPermanentlyHandled({
        status: 'skipped',
        attempts: 0,
        at: 'x',
        threadId: 't',
      }),
    ).toBe(true);
  });

  it('is false for a failed message still under the attempt limit', () => {
    expect(
      isPermanentlyHandled({
        status: 'failed',
        attempts: MAX_ATTEMPTS - 1,
        at: 'x',
        threadId: 't',
      }),
    ).toBe(false);
  });

  it('is true for a failed message at or over the attempt limit', () => {
    expect(
      isPermanentlyHandled({
        status: 'failed',
        attempts: MAX_ATTEMPTS,
        at: 'x',
        threadId: 't',
      }),
    ).toBe(true);
  });
});

describe('thread reply timestamps and cap', () => {
  it('returns an empty array for an unrecorded thread', () => {
    const client = fakeClient();
    expect(getThreadReplyTimestamps(client, 't1')).toEqual([]);
  });

  it('ignores stored timestamps that are not strings', () => {
    const client = fakeClient();
    client.store.set(
      'email-respond|thread-replies|t1',
      JSON.stringify(['2026-10-13T00:00:00.000Z', 5, null]),
    );
    expect(getThreadReplyTimestamps(client, 't1')).toEqual([
      '2026-10-13T00:00:00.000Z',
    ]);
  });

  it('records and reads back timestamps', () => {
    const client = fakeClient();
    recordThreadReply(client, 't1', '2026-10-13T00:00:00.000Z');
    recordThreadReply(client, 't1', '2026-10-13T00:30:00.000Z');
    expect(getThreadReplyTimestamps(client, 't1')).toEqual([
      '2026-10-13T00:00:00.000Z',
      '2026-10-13T00:30:00.000Z',
    ]);
  });

  it('drops timestamps older than 24h from the kept window', () => {
    const client = fakeClient();
    recordThreadReply(client, 't1', '2026-10-11T00:00:00.000Z');
    recordThreadReply(client, 't1', '2026-10-13T00:00:00.000Z');
    expect(getThreadReplyTimestamps(client, 't1')).toEqual([
      '2026-10-13T00:00:00.000Z',
    ]);
  });

  it('counts replies since a cutoff for the hourly cap', () => {
    const client = fakeClient();
    recordThreadReply(client, 't1', '2026-10-13T00:00:00.000Z');
    recordThreadReply(client, 't1', '2026-10-13T00:20:00.000Z');
    recordThreadReply(client, 't1', '2026-10-13T00:40:00.000Z');
    const sinceMs = Date.parse('2026-10-13T00:10:00.000Z');
    expect(threadReplyCountSince(client, 't1', sinceMs)).toBe(2);
  });

  it('keeps thread reply counts independent per thread', () => {
    const client = fakeClient();
    recordThreadReply(client, 't1', '2026-10-13T00:00:00.000Z');
    recordThreadReply(client, 't2', '2026-10-13T00:00:00.000Z');
    expect(getThreadReplyTimestamps(client, 't1')).toHaveLength(1);
    expect(getThreadReplyTimestamps(client, 't2')).toHaveLength(1);
  });
});
