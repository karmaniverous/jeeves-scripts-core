import { describe, expect, it, vi } from 'vitest';

import { type SlackApiCall, slackDirectory } from './slack-directory.js';

describe('slackDirectory.lookupUserByEmail', () => {
  it('returns the user id', async () => {
    const call: SlackApiCall = vi.fn(() =>
      Promise.resolve({ ok: true, user: { id: 'U1' } }),
    );
    expect(
      await slackDirectory(call).lookupUserByEmail('mark@example.com'),
    ).toBe('U1');
    expect(call).toHaveBeenCalledWith('users.lookupByEmail', {
      email: 'mark@example.com',
    });
  });

  it('returns null for no user or a missing scope', async () => {
    for (const error of ['users_not_found', 'missing_scope']) {
      const call: SlackApiCall = vi.fn(() =>
        Promise.reject(new Error(`Slack API users.lookupByEmail: ${error}`)),
      );
      expect(await slackDirectory(call).lookupUserByEmail('a@b.com')).toBe(
        null,
      );
    }
  });

  it('rethrows other errors', async () => {
    const call: SlackApiCall = vi.fn(() =>
      Promise.reject(new Error('Slack API users.lookupByEmail: ratelimited')),
    );
    await expect(
      slackDirectory(call).lookupUserByEmail('a@b.com'),
    ).rejects.toThrow(/ratelimited/);
  });
});

describe('slackDirectory.resolveChannel', () => {
  it('resolves a channel id with conversations.info', async () => {
    const call: SlackApiCall = vi.fn(() =>
      Promise.resolve({
        ok: true,
        channel: { id: 'C0ABCDEF', is_member: true },
      }),
    );
    expect(await slackDirectory(call).resolveChannel('c0abcdef')).toEqual({
      id: 'C0ABCDEF',
      isMember: true,
    });
  });

  /**
   * A fake Slack: `conversations.info` knows only C0ABCDEF; the channel
   * list holds #general (C111) and #community (C222).
   */
  const fakeSlack: SlackApiCall = (method, params) => {
    if (method === 'conversations.info') {
      return params.channel === 'C0ABCDEF'
        ? Promise.resolve({
            ok: true,
            channel: { id: 'C0ABCDEF', is_member: true },
          })
        : Promise.reject(
            new Error('Slack API conversations.info: channel_not_found'),
          );
    }
    return Promise.resolve({
      ok: true,
      channels: [
        { id: 'C111', name: 'general', is_member: true },
        { id: 'C222', name: 'community', is_member: false },
      ],
    });
  };

  it.each([
    ['#general', { id: 'C111', isMember: true }],
    ['general', { id: 'C111', isMember: true }],
    ['#community', { id: 'C222', isMember: false }],
    ['C0ABCDEF', { id: 'C0ABCDEF', isMember: true }],
    ['#c0abcdef', { id: 'C0ABCDEF', isMember: true }],
    ['#nope', null],
  ])('resolves %s', async (input, expected) => {
    expect(await slackDirectory(fakeSlack).resolveChannel(input)).toEqual(
      expected,
    );
  });

  it('falls back to the name when conversations.info returns no channel', async () => {
    const call: SlackApiCall = vi.fn((method: string) =>
      Promise.resolve(
        method === 'conversations.info'
          ? { ok: true }
          : {
              ok: true,
              channels: [{ id: 'C111', name: 'general', is_member: true }],
            },
      ),
    );
    expect(await slackDirectory(call).resolveChannel('general')).toEqual({
      id: 'C111',
      isMember: true,
    });
  });

  it('resolves a #name across conversations.list pages', async () => {
    const call: SlackApiCall = vi.fn((_m: string, p: Record<string, string>) =>
      Promise.resolve(
        p.cursor
          ? {
              ok: true,
              channels: [{ id: 'C2', name: 'harness', is_member: false }],
            }
          : {
              ok: true,
              channels: [{ id: 'C1', name: 'general', is_member: true }],
              response_metadata: { next_cursor: 'next' },
            },
      ),
    );
    expect(await slackDirectory(call).resolveChannel('#Harness')).toEqual({
      id: 'C2',
      isMember: false,
    });
  });

  it('returns null for an unknown name', async () => {
    const call: SlackApiCall = vi.fn(() =>
      Promise.resolve({ ok: true, channels: [] }),
    );
    expect(await slackDirectory(call).resolveChannel('#nope')).toBe(null);
  });
});

describe('slackDirectory.isChannelMember', () => {
  it('pages through members', async () => {
    const call: SlackApiCall = vi.fn((_m: string, p: Record<string, string>) =>
      Promise.resolve(
        p.cursor
          ? { ok: true, members: ['U2'] }
          : {
              ok: true,
              members: ['U1'],
              response_metadata: { next_cursor: 'n' },
            },
      ),
    );
    const d = slackDirectory(call);
    expect(await d.isChannelMember('C1', 'U2')).toBe(true);
    expect(await d.isChannelMember('C1', 'U9')).toBe(false);
  });
});
