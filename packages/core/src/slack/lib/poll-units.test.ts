/**
 * Tests for the modules split out of slack/poll: token resolution
 * (channel-token), file text inlining (file-content), message files
 * (message-writer), channel workspaces (channel-workspace) and channel
 * directories (channel-dir). Slack and silo routing are mocked.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  slackApi: vi.fn(),
  slackBotTokens: vi.fn(() => ({ default: 'xoxb-d', vc: 'xoxb-vc' })),
  basePath: '',
}));

vi.mock('./slack-api.js', () => ({
  RATE_LIMIT_MS: 0,
  sleep: () => Promise.resolve(),
  slackApi: mocks.slackApi,
}));
vi.mock('../../lib/openclaw-config.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  slackBotTokens: mocks.slackBotTokens,
}));
vi.mock('../../config/index.js', () => ({
  getBasePathForSlackWorkspace: () => mocks.basePath,
}));

const { getTeamId, getTokens, resolveChannelToken } =
  await import('./channel-token.js');
const { enrichFileContent } = await import('./file-content.js');
const { writeMessage } = await import('./message-writer.js');
const { resolveChannelDir } = await import('./channel-dir.js');
const { channelTeamId, queryChannelTeam } =
  await import('./channel-workspace.js');
const { constants } = await import('../../lib/constants.js');
import type { ChannelInfo } from './channel-info.js';
import type { SlackMessage } from './slack-api.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-poll-'));
  mocks.basePath = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const channel = (over: Partial<ChannelInfo> = {}): ChannelInfo => ({
  name: 'general',
  type: 'channel',
  ...over,
});

describe('channel-token', () => {
  it('getTokens prefers SLACK_BOT_TOKEN, else the OpenClaw config', () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'env-token');
    expect(getTokens()).toEqual({ default: 'env-token' });
    vi.stubEnv('SLACK_BOT_TOKEN', '');
    expect(getTokens()).toEqual({ default: 'xoxb-d', vc: 'xoxb-vc' });
  });

  it('getTeamId returns auth.test team_id and rejects a missing one', async () => {
    mocks.slackApi.mockResolvedValueOnce({ team_id: 'T1' });
    await expect(getTeamId('t')).resolves.toBe('T1');
    expect(mocks.slackApi).toHaveBeenCalledWith('auth.test', {}, 't');
    mocks.slackApi.mockResolvedValueOnce({});
    await expect(getTeamId('t')).rejects.toThrow(
      'auth.test did not return a valid team_id',
    );
  });

  const tokens = { default: 'xoxb-d', vc: 'xoxb-vc' };

  it('uses the tagged account first', async () => {
    await expect(
      resolveChannelToken('C1', channel({ _account: 'vc' }), tokens, {}),
    ).resolves.toBe('xoxb-vc');
    expect(mocks.slackApi).not.toHaveBeenCalled();
  });

  it('then a known sharedTeams workspace, tagging the channel', async () => {
    const info = channel({ sharedTeams: ['Tx', 'Tvc'] });
    await expect(
      resolveChannelToken('C1', info, tokens, { Tvc: 'vc' }),
    ).resolves.toBe('xoxb-vc');
    expect(info._account).toBe('vc');
  });

  it("then the account of the channel's workspace, looked up with the first token", async () => {
    mocks.slackApi.mockResolvedValueOnce({
      channel: { shared_team_ids: ['Tvc'] },
    });
    const info = channel();
    await expect(
      resolveChannelToken('C1', info, tokens, { Tvc: 'vc' }),
    ).resolves.toBe('xoxb-vc');
    expect(mocks.slackApi).toHaveBeenCalledWith(
      'conversations.info',
      { channel: 'C1' },
      'xoxb-d',
    );
    expect(info).toMatchObject({ _account: 'vc', teamId: 'Tvc' });
  });

  it('uses a cached workspace without asking Slack', async () => {
    const info = channel({ teamId: 'Tvc' });
    await expect(
      resolveChannelToken('C1', info, tokens, { Tvc: 'vc' }),
    ).resolves.toBe('xoxb-vc');
    expect(mocks.slackApi).not.toHaveBeenCalled();
  });

  it('falls back to the first token when the channel cannot be read', async () => {
    mocks.slackApi.mockRejectedValue(new Error('channel_not_found'));
    const info = channel();
    await expect(resolveChannelToken('C1', info, tokens, {})).resolves.toBe(
      'xoxb-d',
    );
    expect(info).toMatchObject({
      _account: 'default',
      teamId: constants().PRIMARY_WORKSPACE,
    });
  });

  it('throws when there is no token at all', async () => {
    await expect(resolveChannelToken('C1', channel(), {}, {})).rejects.toThrow(
      'No Slack token available for channel C1.',
    );
  });
});

describe('file-content', () => {
  it('inlines text files and fences snippets; skips other types', async () => {
    mocks.slackApi.mockImplementation((_m: string, p: { file: string }) =>
      Promise.resolve({
        file: {
          url_private_download: `https://files/${p.file}`,
          pretty_type: 'Type Script',
        },
      }),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response('body')));
    vi.stubGlobal('fetch', fetchMock);
    const msg = {
      ts: '1',
      files: [
        { id: 'F1', name: 'a', filetype: 'text', mimetype: 'text/plain' },
        { id: 'F2', name: 'b', filetype: 'snippet', mimetype: 'text/plain' },
        { id: 'F3', name: 'c', filetype: 'png', mimetype: 'image/png' },
      ],
    } as SlackMessage;
    await enrichFileContent(msg, 'tok');
    expect(msg.files?.map((f) => f.markdown)).toEqual([
      'body',
      '```typescript\nbody\n```',
      undefined,
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://files/F1', {
      headers: { Authorization: 'Bearer tok' },
    });
  });
});

describe('message-writer', () => {
  it('writes the message once, with author, thread, files and reactions', () => {
    const msg = {
      ts: '1700000000.000100',
      user: 'U1',
      text: 'hi',
      thread_ts: '1699999999.000000',
      reply_count: 2,
      reactions: [{ name: 'tada', count: 3, users: ['U2'] }],
      files: [
        {
          id: 'F1',
          name: 'memo',
          filetype: 'm4a',
          mimetype: 'audio/mp4',
          size: 5,
          transcription: { status: 'complete', preview: { content: 'words' } },
        },
      ],
    } as unknown as SlackMessage;
    const info = channel({ participants: ['U1'] });
    expect(writeMessage(dir, 'C1', info, msg, { U1: 'Ann' })).toBe(true);
    const doc = JSON.parse(
      fs.readFileSync(path.join(dir, '1700000000.000100.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(doc).toEqual({
      ts: '1700000000.000100',
      channelId: 'C1',
      channelName: 'general',
      channelType: 'channel',
      user: 'U1',
      userName: 'Ann',
      text: 'hi',
      date: '2023-11-14T22:13:20.000Z',
      participants: ['U1'],
      threadTs: '1699999999.000000',
      replyCount: 2,
      hasFiles: true,
      files: [
        {
          id: 'F1',
          name: 'memo',
          filetype: 'm4a',
          mimetype: 'audio/mp4',
          size: 5,
          transcript: 'words',
        },
      ],
      reactions: [{ name: 'tada', count: 3 }],
    });
    expect(writeMessage(dir, 'C1', info, msg, {})).toBe(false);
  });

  it('names a bot author by its bot id', () => {
    const msg = { ts: '1', bot_id: 'B1' } as SlackMessage;
    writeMessage(dir, 'C1', channel(), msg, {});
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, '1.json'), 'utf8')),
    ).toMatchObject({ user: 'B1', userName: 'B1', botId: 'B1', text: '' });
  });
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

  it('records the workspace on the channel entry and reuses it', async () => {
    const info = channel();
    mocks.slackApi.mockResolvedValueOnce({
      channel: { shared_team_ids: ['Tx'] },
    });
    await expect(channelTeamId('C1', info, 't', 'Tp')).resolves.toBe('Tx');
    expect(info.teamId).toBe('Tx');
    await expect(channelTeamId('C1', info, 't', 'Tp')).resolves.toBe('Tx');
    expect(mocks.slackApi).toHaveBeenCalledTimes(1);
  });
});

describe('channel-dir', () => {
  it('is {silo}/slack/{name} ({id})', async () => {
    await expect(
      resolveChannelDir('C1', channel({ teamId: 'T1' }), 't'),
    ).resolves.toBe(path.join(dir, 'slack', 'general (C1)'));
    expect(mocks.slackApi).not.toHaveBeenCalled();
  });

  it('renames the directory of a channel renamed in Slack', async () => {
    fs.mkdirSync(path.join(dir, 'slack', 'old-name (C1)'), { recursive: true });
    const target = await resolveChannelDir(
      'C1',
      channel({ name: 'new-name', teamId: 'T1' }),
      't',
    );
    expect(target).toBe(path.join(dir, 'slack', 'new-name (C1)'));
    expect(fs.readdirSync(path.join(dir, 'slack'))).toEqual(['new-name (C1)']);
  });
});
