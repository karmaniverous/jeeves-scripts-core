/**
 * Tests for refreshing the Slack cache from Slack: channel discovery,
 * users and channel members, with injected Slack calls.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./slack-api.js', () => ({
  RATE_LIMIT_MS: 0,
  sleep: () => Promise.resolve(),
  discoverChannels: vi.fn(),
  fetchMembers: vi.fn(),
  fetchUsers: vi.fn(),
}));

import type { ChannelInfo } from './channel-info.js';
import { loadUserCache, saveUserCache } from './slack-cache.js';
import {
  channelFromSlack,
  discoverAll,
  mergeDiscovered,
  refreshParticipants,
  refreshUsers,
  userFromSlack,
} from './slack-sync.js';

let dir: string;
let usersFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-sync-'));
  usersFile = path.join(dir, 'users.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const now = new Date('2026-10-10T02:00:00Z');

describe('channelFromSlack', () => {
  it('names DMs and MPIMs and maps Slack flags', () => {
    expect(channelFromSlack({ id: 'D1', is_im: true, user: 'U1' })).toEqual({
      name: 'dm-U1',
      type: 'dm',
      isPrivate: true,
      isArchived: false,
    });
    expect(
      channelFromSlack({
        id: 'C1',
        name: 'ext',
        is_private: false,
        is_ext_shared: true,
        shared_team_ids: ['T1', 'T2'],
      }),
    ).toEqual({
      name: 'ext',
      type: 'channel',
      isPrivate: false,
      isArchived: false,
      isSlackConnect: true,
      sharedTeams: ['T1', 'T2'],
    });
    expect(channelFromSlack({ id: 'G1', is_mpim: true }).type).toBe('mpim');
  });
});

describe('mergeDiscovered', () => {
  it('adds readable channels and refreshes known ones, keeping their account and members', () => {
    const channels: Record<string, ChannelInfo> = {
      C1: {
        name: 'old-name',
        type: 'channel',
        isSlackConnect: true,
        participants: ['U1'],
        _account: 'work',
        _autoDiscovered: 'then',
      },
    };
    const added = mergeDiscovered(
      channels,
      [
        { id: 'C1', name: 'new-name', is_member: true },
        { id: 'C2', name: 'joined', is_member: true },
        { id: 'C3', name: 'not-joined', is_member: false },
        { id: 'D1', is_im: true, user: 'U2' },
      ],
      'default',
      now,
    );
    expect(added).toBe(2);
    expect(channels.C1).toEqual({
      name: 'new-name',
      type: 'channel',
      isPrivate: false,
      isArchived: false,
      participants: ['U1'],
      _account: 'work',
      _autoDiscovered: 'then',
    });
    expect(channels.C2).toMatchObject({
      name: 'joined',
      _account: 'default',
      _autoDiscovered: now.toISOString(),
    });
    expect(channels.C3).toBeUndefined();
    expect(channels.D1?.name).toBe('dm-U2');
  });

  it('discoverAll continues past a failing account', async () => {
    const channels: Record<string, ChannelInfo> = {};
    const discover = vi
      .fn()
      .mockRejectedValueOnce(new Error('invalid_auth'))
      .mockResolvedValueOnce([{ id: 'C1', name: 'a', is_member: true }]);
    await expect(
      discoverAll(channels, { bad: 'x', good: 'y' }, discover),
    ).resolves.toBe(1);
    expect(channels.C1?._account).toBe('good');
  });
});

describe('users', () => {
  it('userFromSlack keeps the handle, real name, email and bot flag', () => {
    expect(
      userFromSlack({
        id: 'U1',
        name: 'ann',
        real_name: 'Ann B',
        profile: { real_name: 'Ann Bee', email: 'a@x' },
      }),
    ).toEqual({
      name: 'ann',
      alias: 'Ann Bee',
      emails: ['a@x'],
      is_bot: false,
    });
    expect(userFromSlack({ id: 'B1', is_bot: true })).toEqual({
      name: 'B1',
      emails: [],
      is_bot: true,
    });
  });

  it('re-reads users when the cache is stale, keeping users no longer listed', async () => {
    saveUserCache(
      { U0: { name: 'gone', emails: [], is_bot: false } },
      usersFile,
    );
    const list = vi.fn().mockResolvedValue([{ id: 'U1', name: 'ann' }]);
    const users = await refreshUsers(
      { default: 't' },
      usersFile,
      0,
      list,
      Date.now() + 1000,
    );
    expect(Object.keys(users).sort()).toEqual(['U0', 'U1']);
    expect(loadUserCache(usersFile).U1?.name).toBe('ann');
  });

  it('uses a fresh cache without asking Slack', async () => {
    saveUserCache(
      { U1: { name: 'ann', emails: [], is_bot: false } },
      usersFile,
    );
    const list = vi.fn();
    await refreshUsers({ default: 't' }, usersFile, 60_000, list);
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps the cache when every account fails', async () => {
    const list = vi.fn().mockRejectedValue(new Error('missing_scope'));
    await expect(
      refreshUsers({ default: 't' }, usersFile, 0, list),
    ).resolves.toEqual({});
    expect(fs.existsSync(usersFile)).toBe(false);
  });
});

describe('refreshParticipants', () => {
  it('reads members when unknown or stale, and not when fresh', async () => {
    const info: ChannelInfo = { name: 'a', type: 'channel' };
    const members = vi.fn().mockResolvedValue(['U1', 'U2']);
    await refreshParticipants('C1', info, 't', 60_000, members, now);
    expect(info).toMatchObject({
      participants: ['U1', 'U2'],
      participantsAt: now.toISOString(),
    });
    await refreshParticipants('C1', info, 't', 60_000, members, now);
    expect(members).toHaveBeenCalledTimes(1);
  });

  it('keeps cached members when Slack refuses', async () => {
    const info: ChannelInfo = {
      name: 'a',
      type: 'channel',
      participants: ['U1'],
    };
    const members = vi.fn().mockRejectedValue(new Error('missing_scope'));
    await refreshParticipants('C1', info, 't', 0, members, now);
    expect(info.participants).toEqual(['U1']);
    expect(info.participantsAt).toBeUndefined();
  });
});
