/**
 * Tests for workspace reading: scopes from the response header, member
 * channels paged and mapped, failures recorded (not thrown; Slack's
 * code, anything else as unexpected), channels
 * deduplicated across workspaces, and the history fallback's paging
 * (a fixed bound and the cursor, in both of Slack's paging modes; a cut
 * read flagged).
 */

import { describe, expect, it, vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import { channel, scriptedSlack, ts, workspace } from './fakes.test-helper.js';
import { UNEXPECTED } from './report-safe.js';
import {
  MAX_HISTORY_PAGES,
  memberChannels,
  missingScopes,
  readHistory,
  readWorkspace,
  scopeCapturingFetch,
  writeScopeFor,
} from './workspaces.js';

describe('scopes', () => {
  it('captures the scopes header from the last response that had one', async () => {
    const headers = ['channels:read, groups:read', null];
    const base = vi.fn(() => {
      const value = headers.shift();
      return Promise.resolve(
        new Response(
          '{}',
          value
            ? { headers: [[['x', 'oauth', 'scopes'].join('-'), value]] }
            : {},
        ),
      );
    });
    const capture = scopeCapturingFetch(base);
    expect(capture.scopes()).toBeUndefined();
    await capture.fetch('https://slack.com/api/auth.test');
    await capture.fetch('https://slack.com/api/users.conversations');
    expect(capture.scopes()).toEqual(['channels:read', 'groups:read']);
  });

  it('lists the needed scopes a token lacks', () => {
    expect(missingScopes(undefined)).toEqual([]);
    expect(
      missingScopes(['channels:read', 'groups:read', 'channels:write.topic']),
    ).toEqual(['groups:write.topic']);
    expect(writeScopeFor(true)).toBe('groups:write.topic');
    expect(writeScopeFor(false)).toBe('channels:write.topic');
  });
});

describe('readWorkspace', () => {
  it('reads the team and every page of member channels', async () => {
    const pages = [
      {
        channels: [
          {
            id: 'C1',
            name: 'general',
            purpose: { value: 'About' },
            topic: { value: 'Now' },
          },
          { id: 'G2', is_private: true },
        ],
        response_metadata: { next_cursor: 'next' },
      },
      {
        channels: [{ id: 'C3', name: 'third' }],
        response_metadata: { next_cursor: '' },
      },
    ];
    const { client, calls } = scriptedSlack({
      'auth.test': () => ({ ok: true, team: 'Acme' }),
      'users.conversations': () => pages.shift() ?? {},
    });
    const ws = await readWorkspace('work', client, () => ['channels:read']);
    expect(ws).toMatchObject({
      account: 'work',
      team: 'Acme',
      scopes: ['channels:read'],
    });
    expect(ws.error).toBeUndefined();
    expect(ws.channels).toEqual([
      {
        id: 'C1',
        name: 'general',
        isPrivate: false,
        purpose: 'About',
        topic: 'Now',
        account: 'work',
      },
      {
        id: 'G2',
        name: 'G2',
        isPrivate: true,
        purpose: '',
        topic: '',
        account: 'work',
      },
      {
        id: 'C3',
        name: 'third',
        isPrivate: false,
        purpose: '',
        topic: '',
        account: 'work',
      },
    ]);
    expect(calls[1]?.params).toEqual({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    expect(calls[2]?.params).toMatchObject({ cursor: 'next' });
  });

  it('records a refusal instead of throwing', async () => {
    const { client } = scriptedSlack({
      'auth.test': () => ({ team: 'Acme' }),
      'users.conversations': () => {
        throw new SlackApiError('users.conversations', 'missing_scope');
      },
    });
    const ws = await readWorkspace('globex', client, () => undefined);
    expect(ws.error).toBe('Slack users.conversations failed: missing_scope');
    expect(ws.channels).toEqual([]);
    expect(ws).not.toHaveProperty('scopes');
  });

  it('records any other failure as unexpected, its message on stderr only', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { client } = scriptedSlack({
      'auth.test': () => ({ team: 'Acme' }),
      'users.conversations': () => ({ channels: [{ name: 'Now alpha' }] }),
    });
    const ws = await readWorkspace('globex', client, () => undefined);
    expect(ws.error).toBe(UNEXPECTED);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        'slack/refresh-channel-meta: reading workspace globex: ',
      ),
    );
    stderr.mockRestore();
  });
});

describe('memberChannels', () => {
  it('keeps each channel once (first workspace wins), drops exclusions, sorts by name', () => {
    const shared = channel('C2', { name: 'shared' });
    const first = workspace('default', [
      channel('C3', { name: 'zeta' }),
      shared,
    ]);
    const second = workspace('globex', [
      { ...shared, account: 'globex' },
      channel('C4', { name: 'alpha', account: 'globex' }),
    ]);
    const list = memberChannels([first, second], new Set(['C3']));
    expect(list.map(({ channel: c, ws }) => [c.id, c.account, ws])).toEqual([
      ['C4', 'globex', second],
      ['C2', 'default', first],
    ]);
  });
});

/**
 * `conversations.history` as Slack serves it (no `latest`), `size` per
 * page, the next page through `response_metadata.next_cursor`. With a
 * real `oldest`: the window nearest `oldest` first, the cursor paging
 * forward. With `oldest: '0'` (treated as unset): the newest window
 * first, the cursor paging backward. Newest first within a page either
 * way.
 */
const slackHistory = (seconds: readonly number[], size: number) => {
  const all = seconds.map((s) => ({ ts: ts(s), user: 'U1' }));
  return (params: Record<string, unknown>) => {
    const oldest = Number(params.oldest);
    const offset = Number(params.cursor ?? 0);
    const forward = oldest > 0;
    const range = all
      .filter((m) => Number(m.ts) > oldest)
      .sort((a, b) => (forward ? 1 : -1) * (Number(a.ts) - Number(b.ts)));
    const end = offset + size;
    const page = range
      .slice(offset, end)
      .sort((a, b) => Number(b.ts) - Number(a.ts));
    return {
      messages: [...page, ...(offset === 0 ? [{}] : [])],
      has_more: end < range.length,
      response_metadata: { next_cursor: end < range.length ? String(end) : '' },
    };
  };
};

describe('readHistory', () => {
  it('pages forward from a bound, keeping it, and returns oldest first', async () => {
    const { client, calls } = scriptedSlack({
      'conversations.history': slackHistory([1, 2, 3, 4, 5, 6, 7], 3),
    });
    const history = await readHistory(client, 'C1', ts(1));
    expect(history).toEqual({
      messages: [2, 3, 4, 5, 6, 7].map((s) => ({ ts: ts(s), user: 'U1' })),
      truncated: false,
    });
    expect(calls.map((c) => c.params)).toEqual([
      { channel: 'C1', limit: '200', oldest: ts(1) },
      { channel: 'C1', limit: '200', oldest: ts(1), cursor: '3' },
    ]);
  });

  it('reads from the beginning without a bound', async () => {
    const { client, calls } = scriptedSlack({
      'conversations.history': slackHistory([], 3),
    });
    expect(await readHistory(client, 'C1', undefined)).toEqual({
      messages: [],
      truncated: false,
    });
    expect(calls.map((c) => c.params.oldest)).toEqual(['0']);
  });

  it('pages backward from the newest without a bound and returns oldest first', async () => {
    const { client, calls } = scriptedSlack({
      'conversations.history': slackHistory([1, 2, 3, 4, 5], 2),
    });
    expect(await readHistory(client, 'C1', undefined)).toEqual({
      messages: [1, 2, 3, 4, 5].map((s) => ({ ts: ts(s), user: 'U1' })),
      truncated: false,
    });
    expect(calls.map((c) => [c.params.oldest, c.params.cursor])).toEqual([
      ['0', undefined],
      ['0', '2'],
      ['0', '4'],
    ]);
  });

  it('says a forward read from a bound was cut, missing the newest', async () => {
    const seconds = Array.from(
      { length: MAX_HISTORY_PAGES + 2 },
      (_, i) => i + 1,
    );
    const { client, calls } = scriptedSlack({
      'conversations.history': slackHistory(seconds, 1),
    });
    const history = await readHistory(client, 'C1', ts(1));
    expect(calls).toHaveLength(MAX_HISTORY_PAGES);
    expect(history.truncated).toBe(true);
    expect(history.messages.map((m) => m.ts)).toEqual(
      seconds.slice(1, -1).map(ts),
    );
  });

  it('says a backward read was cut when Slack has more after the page cap, missing the oldest', async () => {
    const seconds = Array.from(
      { length: MAX_HISTORY_PAGES + 1 },
      (_, i) => i + 1,
    );
    const cut = scriptedSlack({
      'conversations.history': slackHistory(seconds, 1),
    });
    const history = await readHistory(cut.client, 'C1', undefined);
    expect(cut.calls).toHaveLength(MAX_HISTORY_PAGES);
    expect(history.truncated).toBe(true);
    expect(history.messages.map((m) => m.ts)).toEqual(seconds.slice(1).map(ts));
    const whole = scriptedSlack({
      'conversations.history': slackHistory(seconds.slice(1), 1),
    });
    expect((await readHistory(whole.client, 'C1', undefined)).truncated).toBe(
      false,
    );
  });

  it('throws Slack refusals for the caller to report', async () => {
    const { client } = scriptedSlack({
      'conversations.history': () => {
        throw new SlackApiError('conversations.history', 'not_in_channel');
      },
    });
    await expect(readHistory(client, 'C1', undefined)).rejects.toThrow(
      'not_in_channel',
    );
  });
});
