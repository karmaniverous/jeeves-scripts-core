/**
 * Tests for the session-refresh gateway wrappers over a fake `gatewayRpc`:
 * pinned real-shape results parse (unknown fields pass through), the list
 * pages until complete, and a malformed row, an error response, a thrown
 * call or inconsistent paging each fail. `session-changed` is recognised
 * from the CLI's error shape (`GatewayRpcError` details).
 */

import { describe, expect, it, vi } from 'vitest';

import { GatewayRpcError } from '../../lib/gateway-rpc.js';
import {
  LIST_PAGE_1,
  LIST_PAGE_2,
  MAIN_DESCRIBE,
  MAIN_ROW,
} from './session-refresh.fixtures.js';
import {
  activeSessionKeys,
  describeSession,
  isSessionChanged,
  LIST_PAGE_SIZE,
  listSessions,
  MAX_LIST_PAGES,
  resetSession,
  sessionGateway,
} from './session-refresh-gateway.js';

/** A fake RPC answering each call in turn. */
const rpcOf = (...answers: unknown[]) => {
  const rpc =
    vi.fn<
      (method: string, params: Record<string, unknown>) => Promise<unknown>
    >();
  for (const a of answers)
    rpc.mockImplementationOnce(() =>
      a instanceof Error ? Promise.reject(a) : Promise.resolve(a),
    );
  return rpc;
};

const changed = () =>
  new GatewayRpcError('sessions.reset', 'session changed', 'INVALID_REQUEST', {
    reason: 'session-changed',
  });

describe('listSessions', () => {
  it('pages with limit/offset until hasMore is false, keeping unknown fields', async () => {
    const rpc = rpcOf(LIST_PAGE_1, LIST_PAGE_2);
    const rows = await listSessions(rpc);
    expect(rows.map((r) => r.key)).toEqual([
      'agent:main:slack:channel:c0000000001',
      'agent:main:main',
      'agent:main:slack:direct:u0000000003',
      'agent:main:subagent:00000000-0000-4000-8000-0000000000aa',
    ]);
    expect(rpc.mock.calls).toEqual([
      ['sessions.list', { limit: LIST_PAGE_SIZE, offset: 0 }],
      ['sessions.list', { limit: LIST_PAGE_SIZE, offset: 2 }],
    ]);
    expect(rows[0]).toMatchObject({
      classification: 'channel',
      totalTokens: 283_032,
    });
  });

  it('deduplicates a row that moved between pages, keeping the first', async () => {
    const moved = { ...MAIN_ROW, sessionId: 'later' };
    const rows = await listSessions(
      rpcOf(LIST_PAGE_1, { sessions: [moved], hasMore: false }),
    );
    expect(rows.filter((r) => r.key === 'agent:main:main')).toEqual([
      expect.objectContaining({ sessionId: MAIN_ROW.sessionId }),
    ]);
  });

  it('accepts an empty list', async () => {
    await expect(listSessions(rpcOf({ sessions: [] }))).resolves.toEqual([]);
  });

  it.each([
    ['a row missing key', { sessions: [{ sessionId: 's' }] }],
    ['a row missing sessionId', { sessions: [{ key: 'agent:main:main' }] }],
    [
      'a row with a mistyped field',
      { sessions: [{ ...MAIN_ROW, hasActiveRun: 'no' }] },
    ],
    ['no sessions array', { rows: [] }],
    ['a non-object', 'nope'],
  ])('fails on %s', async (_name, page) => {
    await expect(listSessions(rpcOf(page))).rejects.toThrow(
      'gateway sessions.list returned an unexpected shape',
    );
  });

  it('fails when more rows are reported without a forward nextOffset', async () => {
    await expect(
      listSessions(rpcOf({ sessions: [], hasMore: true })),
    ).rejects.toThrow('without a forward nextOffset (offset 0)');
    await expect(
      listSessions(rpcOf({ sessions: [], hasMore: true, nextOffset: 0 })),
    ).rejects.toThrow('without a forward nextOffset');
  });

  it('fails a list that never ends', async () => {
    let offset = 0;
    const rpc = vi.fn(() =>
      Promise.resolve({ sessions: [], hasMore: true, nextOffset: ++offset }),
    );
    await expect(listSessions(rpc)).rejects.toThrow(
      `did not finish within ${String(MAX_LIST_PAGES)} pages`,
    );
  });

  it('passes a thrown call or an error response through', async () => {
    await expect(
      listSessions(rpcOf(new Error('gateway down'))),
    ).rejects.toThrow('gateway down');
    await expect(
      listSessions(rpcOf(new GatewayRpcError('sessions.list', 'forbidden'))),
    ).rejects.toThrow('gateway sessions.list failed: forbidden');
  });
});

describe('activeSessionKeys', () => {
  it('pages sessions.list with activeOnly and returns the keys', async () => {
    const rpc = rpcOf(
      { sessions: [MAIN_ROW], hasMore: true, nextOffset: 1 },
      { sessions: [{ key: 'agent:ops:main', sessionId: 's' }] },
    );
    const keys = await activeSessionKeys(rpc);
    expect([...keys]).toEqual(['agent:main:main', 'agent:ops:main']);
    expect(rpc.mock.calls).toEqual([
      ['sessions.list', { activeOnly: true, limit: LIST_PAGE_SIZE, offset: 0 }],
      ['sessions.list', { activeOnly: true, limit: LIST_PAGE_SIZE, offset: 1 }],
    ]);
  });

  it('fails on a malformed active list or a failed call', async () => {
    await expect(
      activeSessionKeys(rpcOf({ sessions: [{ key: 'k' }] })),
    ).rejects.toThrow('gateway sessions.list returned an unexpected shape');
    await expect(
      activeSessionKeys(rpcOf(new Error('gateway down'))),
    ).rejects.toThrow('gateway down');
  });
});

describe('describeSession', () => {
  it('returns the row, which may omit the activity fields', async () => {
    const rpc = rpcOf(MAIN_DESCRIBE);
    const r = await describeSession(rpc, 'agent:main:main');
    expect(rpc).toHaveBeenCalledWith('sessions.describe', {
      key: 'agent:main:main',
    });
    expect(r.sessionId).toBe(MAIN_ROW.sessionId);
    expect(r.hasActiveRun).toBeUndefined();
    expect(r.activeRunIds).toBeUndefined();
  });

  it('fails on a malformed answer or a row for another key', async () => {
    await expect(describeSession(rpcOf({}), 'k')).rejects.toThrow(
      'gateway sessions.describe returned an unexpected shape',
    );
    await expect(
      describeSession(rpcOf(MAIN_DESCRIBE), 'agent:main:x'),
    ).rejects.toThrow('returned agent:main:main for agent:main:x');
  });
});

describe('resetSession', () => {
  it('resets with the key and the expected session id', async () => {
    const rpc = rpcOf({ ok: true, key: 'k' });
    await expect(resetSession(rpc, 'k', 'sid')).resolves.toBe('reset');
    expect(rpc).toHaveBeenCalledWith('sessions.reset', {
      key: 'k',
      expectedSessionId: 'sid',
    });
  });

  it('reads a session-changed rejection as changed', async () => {
    await expect(resetSession(rpcOf(changed()), 'k', 'sid')).resolves.toBe(
      'changed',
    );
  });

  it('throws any other failure', async () => {
    await expect(
      resetSession(
        rpcOf(
          new GatewayRpcError('sessions.reset', 'missing scope', 'FORBIDDEN'),
        ),
        'k',
        's',
      ),
    ).rejects.toThrow('missing scope');
    await expect(
      resetSession(rpcOf('not an object'), 'k', 's'),
    ).rejects.toThrow('gateway sessions.reset returned an unexpected shape');
  });
});

describe('isSessionChanged', () => {
  it.each([
    ['the CLI shape', changed(), true],
    [
      'another reason',
      new GatewayRpcError('m', 'x', 'INVALID_REQUEST', { reason: 'other' }),
      false,
    ],
    ['no details', new GatewayRpcError('m', 'x'), false],
    ['a plain error', new Error('session-changed'), false],
  ])('%s: %s', (_name, err, expected) => {
    expect(isSessionChanged(err)).toBe(expected);
  });
});

describe('sessionGateway', () => {
  it('binds the four calls to one RPC caller', async () => {
    const rpc = rpcOf(
      { sessions: [] },
      { sessions: [MAIN_ROW] },
      MAIN_DESCRIBE,
      {},
    );
    const gw = sessionGateway(rpc);
    await expect(gw.list()).resolves.toEqual([]);
    await expect(gw.activeKeys()).resolves.toEqual(
      new Set(['agent:main:main']),
    );
    await expect(gw.describe('agent:main:main')).resolves.toMatchObject({
      key: 'agent:main:main',
    });
    await expect(gw.reset('agent:main:main', 'sid')).resolves.toBe('reset');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'sessions.list',
      'sessions.list',
      'sessions.describe',
      'sessions.reset',
    ]);
  });
});
