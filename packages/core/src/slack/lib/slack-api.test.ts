import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeFetch, type FetchCall } from '../../lib/fake-fetch.test-helper.js';
import {
  discoverChannels,
  fetchHistoryPage,
  fetchMembers,
  fetchReplies,
  fetchUsers,
  slackApi,
} from './slack-api.js';

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sleepAsync: () => Promise.resolve(),
}));

let calls: FetchCall[];
const serve = (pages: Record<string, unknown[]>) => {
  const fake = fakeFetch((call) => {
    const method = call.url.pathname.replace('/api/', '');
    const queue = pages[method] ?? [];
    return { body: queue.shift() ?? { ok: true } };
  });
  calls = fake.calls;
  vi.stubGlobal('fetch', fake.fetch);
};

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slackApi', () => {
  it('sends the method, query and bearer token, and returns the body', async () => {
    serve({ 'auth.test': [{ ok: true, team_id: 'T1' }] });
    await expect(slackApi('auth.test', { a: '1' }, 'xoxb-1')).resolves.toEqual({
      ok: true,
      team_id: 'T1',
    });
    expect(calls[0]?.url.href).toBe('https://slack.com/api/auth.test?a=1');
    expect(calls[0]?.headers.authorization).toBe('Bearer xoxb-1');
  });

  it('rejects a Slack error and a non-JSON body', async () => {
    serve({ 'auth.test': [{ ok: false, error: 'invalid_auth' }, 'not json'] });
    await expect(slackApi('auth.test', {}, 't')).rejects.toThrow(
      'Slack auth.test failed: invalid_auth',
    );
    await expect(slackApi('auth.test', {}, 't')).rejects.toThrow();
  });
});

describe('paginated reads', () => {
  it('fetchHistoryPage reads one page after oldest, oldest first, and reports more', async () => {
    serve({
      'conversations.history': [
        {
          ok: true,
          messages: [{ ts: '7' }, { ts: '5' }, { ts: '1' }],
          has_more: true,
          response_metadata: { next_cursor: 'c2' },
        },
        { ok: true, messages: [] },
      ],
    });
    const page = await fetchHistoryPage('C1', '2', 't');
    expect(page.messages.map((m) => m.ts)).toEqual(['5', '7']);
    expect(page.hasMore).toBe(true);
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      channel: 'C1',
      limit: '200',
      oldest: '2',
    });
    await expect(fetchHistoryPage('C1', '7', 't')).resolves.toEqual({
      messages: [],
      hasMore: false,
    });
  });

  it('fetchReplies drops the parent and replies at or before oldest', async () => {
    serve({
      'conversations.replies': [
        {
          ok: true,
          messages: [{ ts: '1' }, { ts: '2' }, { ts: '4' }],
          response_metadata: { next_cursor: 'n' },
        },
        { ok: true, messages: [{ ts: '6' }] },
      ],
    });
    const replies = await fetchReplies('C1', '1', '2', 't');
    expect(replies.map((r) => r.ts)).toEqual(['4', '6']);
  });

  it('discoverChannels, fetchMembers and fetchUsers follow next_cursor', async () => {
    serve({
      'conversations.list': [
        {
          ok: true,
          channels: [{ id: 'C1' }],
          response_metadata: { next_cursor: 'x' },
        },
        { ok: true, channels: [{ id: 'C2' }] },
      ],
      'conversations.members': [
        { ok: true, members: ['U1'], response_metadata: { next_cursor: 'y' } },
        { ok: true, members: ['U2'] },
      ],
      'users.list': [{ ok: true, members: [{ id: 'U1', name: 'jane' }] }],
    });
    expect((await discoverChannels('t')).map((c) => c.id)).toEqual([
      'C1',
      'C2',
    ]);
    expect(await fetchMembers('C1', 't')).toEqual(['U1', 'U2']);
    expect(await fetchUsers('t')).toEqual([{ id: 'U1', name: 'jane' }]);
  });
});
