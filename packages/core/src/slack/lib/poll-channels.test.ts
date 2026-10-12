/**
 * Tests for the channel modules split out of slack/poll: channel
 * workspaces (channel-workspace) and channel directories (channel-dir).
 * Slack and silo routing are mocked.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  slackApi: vi.fn(),
  basePath: '',
}));

vi.mock('./slack-api.js', () => ({
  RATE_LIMIT_MS: 0,
  sleep: () => Promise.resolve(),
  slackApi: mocks.slackApi,
}));
vi.mock('../../config/index.js', () => ({
  getBasePathForSlackWorkspace: () => mocks.basePath,
}));

const { resolveChannelDir } = await import('./channel-dir.js');
const { channelTeamId, queryChannelTeam } =
  await import('./channel-workspace.js');
import type { ChannelInfo } from './channel-info.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-poll-'));
  mocks.basePath = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

const channel = (over: Partial<ChannelInfo> = {}): ChannelInfo => ({
  name: 'general',
  type: 'channel',
  ...over,
});

describe('channel-workspace', () => {
  const ask = (resp: unknown) => {
    mocks.slackApi.mockResolvedValueOnce(resp);
    return queryChannelTeam('C1', 't', 'Tp');
  };

  it('is the first shared team when the primary is not among them', async () => {
    await expect(
      ask({ channel: { shared_team_ids: ['Tx', 'Ty'] } }),
    ).resolves.toBe('Tx');
  });

  it('is the primary workspace otherwise, or on any error', async () => {
    await expect(
      ask({ channel: { shared_team_ids: ['Tx', 'Tp'] } }),
    ).resolves.toBe('Tp');
    // DMs carry no shared_team_ids (as before: they route to the primary).
    await expect(ask({ channel: { context_team_id: 'Tx' } })).resolves.toBe(
      'Tp',
    );
    await expect(ask({})).resolves.toBe('Tp');
    mocks.slackApi.mockRejectedValueOnce(new Error('channel_not_found'));
    await expect(queryChannelTeam('C1', 't', 'Tp')).resolves.toBe('Tp');
  });

  it("gives channels without shared teams, and unreadable ones, the reading account's workspace", async () => {
    mocks.slackApi.mockResolvedValueOnce({
      channel: { context_team_id: 'Twork' },
    });
    await expect(queryChannelTeam('D1', 't', 'Tp', 'Twork')).resolves.toBe(
      'Twork',
    );
    mocks.slackApi.mockRejectedValueOnce(new Error('channel_not_found'));
    await expect(queryChannelTeam('C1', 't', 'Tp', 'Twork')).resolves.toBe(
      'Twork',
    );
    // Shared channels keep the old rule.
    mocks.slackApi.mockResolvedValueOnce({
      channel: { shared_team_ids: ['Twork', 'Tp'] },
    });
    await expect(queryChannelTeam('C2', 't', 'Tp', 'Twork')).resolves.toBe(
      'Tp',
    );
  });

  it("puts a DM in its reading account's workspace, without Slack and over a cached value", async () => {
    const teams = { default: 'Tp', work: 'Twork' };
    const dm = channel({ type: 'dm', _account: 'work', teamId: 'Tp' });
    await expect(channelTeamId('D1', dm, 't', teams)).resolves.toBe('Twork');
    expect(dm.teamId).toBe('Twork');
    const mpim = channel({ type: 'mpim' });
    await expect(channelTeamId('G1', mpim, 't', teams)).resolves.toBe('Tp');
    expect(mocks.slackApi).not.toHaveBeenCalled();
  });

  it('records the workspace on the channel entry and reuses it', async () => {
    const info = channel();
    mocks.slackApi.mockResolvedValueOnce({
      channel: { shared_team_ids: ['Tx'] },
    });
    await expect(
      channelTeamId('C1', info, 't', { default: 'Tp' }),
    ).resolves.toBe('Tx');
    expect(info.teamId).toBe('Tx');
    await expect(
      channelTeamId('C1', info, 't', { default: 'Tp' }),
    ).resolves.toBe('Tx');
    expect(mocks.slackApi).toHaveBeenCalledTimes(1);
  });
});

describe('channel-dir', () => {
  it('is {silo}/slack/{name} ({id})', async () => {
    await expect(
      resolveChannelDir('C1', channel({ teamId: 'T1' }), 't', {}),
    ).resolves.toBe(path.join(dir, 'slack', 'general (C1)'));
    expect(mocks.slackApi).not.toHaveBeenCalled();
  });

  it('renames the directory of a channel renamed in Slack', async () => {
    fs.mkdirSync(path.join(dir, 'slack', 'old-name (C1)'), { recursive: true });
    const target = await resolveChannelDir(
      'C1',
      channel({ name: 'new-name', teamId: 'T1' }),
      't',
      {},
    );
    expect(target).toBe(path.join(dir, 'slack', 'new-name (C1)'));
    expect(fs.readdirSync(path.join(dir, 'slack'))).toEqual(['new-name (C1)']);
  });

  it.each(['EPERM', 'EXDEV', 'EBUSY', 'EACCES'])(
    'keeps the existing directory and warns when the rename fails with %s',
    async (code) => {
      const slack = path.join(dir, 'slack');
      fs.mkdirSync(path.join(slack, 'old-name (C1)'), { recursive: true });
      const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw Object.assign(new Error(`${code}: rename`), { code });
      });
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const target = await resolveChannelDir(
        'C1',
        channel({ name: 'new-name', teamId: 'T1' }),
        't',
        {},
      );
      expect(target).toBe(path.join(slack, 'old-name (C1)'));
      expect(rename).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `WARN C1: could not rename "old-name (C1)" -> "new-name (C1)" (${code}); keeping "old-name (C1)"`,
      );
      expect(fs.readdirSync(slack)).toEqual(['old-name (C1)']);
      rename.mockRestore();
      warn.mockRestore();
    },
  );

  it('names a failure without an error code by its message', async () => {
    fs.mkdirSync(path.join(dir, 'slack', 'old-name (C1)'), { recursive: true });
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await resolveChannelDir('C1', channel({ name: 'new-name' }), 't', {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(boom)'));
    rename.mockRestore();
    warn.mockRestore();
  });

  it('is the target when no directory for the channel exists yet', async () => {
    fs.mkdirSync(path.join(dir, 'slack', 'other (C2)'), { recursive: true });
    const rename = vi.spyOn(fs, 'renameSync');
    await expect(
      resolveChannelDir('C1', channel({ teamId: 'T1' }), 't', {}),
    ).resolves.toBe(path.join(dir, 'slack', 'general (C1)'));
    expect(rename).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(dir, 'slack'))).toEqual(['other (C2)']);
    rename.mockRestore();
  });

  it('prefers an existing target over an old directory, leaving both in place', async () => {
    const slack = path.join(dir, 'slack');
    fs.mkdirSync(path.join(slack, 'old-name (C1)'), { recursive: true });
    fs.mkdirSync(path.join(slack, 'new-name (C1)'), { recursive: true });
    const rename = vi.spyOn(fs, 'renameSync');
    await expect(
      resolveChannelDir('C1', channel({ name: 'new-name' }), 't', {}),
    ).resolves.toBe(path.join(slack, 'new-name (C1)'));
    expect(rename).not.toHaveBeenCalled();
    expect(fs.readdirSync(slack).sort()).toEqual([
      'new-name (C1)',
      'old-name (C1)',
    ]);
    rename.mockRestore();
  });
});
