/**
 * Tests for the post-reset Slack notice: where it goes (account, channel
 * or DM, thread) for each recorded shape, no notice for a session that is
 * not Slack-keyed with a Slack origin (an agent's main session never, even
 * when its delivery is Slack), and the post through a fake Slack client.
 */

import { describe, expect, it, vi } from 'vitest';

import type { SlackClient } from '../../lib/slack-client.js';
import {
  MAIN_ROW,
  row,
  SLACK_CHANNEL_ROW,
  SLACK_DM_ROW,
} from './session-refresh.fixtures.js';
import {
  isSlackSession,
  NOTICE_TEXT,
  postResetNotice,
  slackNoticeTarget,
} from './session-refresh-notice.js';

/** A test row whose origin is Slack (and nothing more). */
const slackRow = (over: Parameters<typeof row>[0] = {}) =>
  row({ origin: { provider: 'slack' }, ...over });

const fakeSlack = () => {
  const postMessage = vi.fn(() => Promise.resolve({ channel: 'C', ts: '1.2' }));
  const openDm = vi.fn(() => Promise.resolve('D0000000099'));
  const client = { postMessage, openDm } as unknown as SlackClient;
  const slackFor = vi.fn(() => client);
  return { postMessage, openDm, slackFor };
};

describe('slackNoticeTarget', () => {
  it.each([
    [
      'a listed channel row',
      SLACK_CHANNEL_ROW,
      { accountId: 'work', channel: 'C0000000001' },
    ],
    [
      'a listed DM row (the IM channel)',
      SLACK_DM_ROW,
      { accountId: 'default', channel: 'D0000000003' },
    ],
    [
      'a delivery target only',
      slackRow({
        channel: 'slack',
        deliveryContext: { channel: 'slack', to: 'user:U0000000005' },
        lastAccountId: 'other',
      }),
      { accountId: 'other', user: 'U0000000005' },
    ],
    [
      'a channel delivery target over the key, the delivery account over the origin',
      row({
        deliveryContext: {
          channel: 'slack',
          to: 'channel:C0000000010',
          accountId: 'work',
        },
        origin: { provider: 'slack', accountId: 'old' },
      }),
      { accountId: 'work', channel: 'C0000000010' },
    ],
    [
      'the key only (channel), default account',
      slackRow({ key: 'agent:main:slack:channel:c0000000006' }),
      { accountId: 'default', channel: 'C0000000006' },
    ],
    [
      'the key only (DM)',
      slackRow({ key: 'agent:main:slack:direct:u0000000007' }),
      { accountId: 'default', user: 'U0000000007' },
    ],
    [
      'a thread-scoped key',
      row({
        key: 'agent:main:slack:channel:c0000000008:thread:1790000000.000100',
        origin: {
          provider: 'slack',
          nativeChannelId: 'C0000000008',
          accountId: 'work',
        },
      }),
      {
        accountId: 'work',
        channel: 'C0000000008',
        threadTs: '1790000000.000100',
      },
    ],
    [
      'an unparseable delivery target falls back to the key',
      slackRow({ deliveryContext: { channel: 'slack', to: 'somewhere' } }),
      { accountId: 'default', channel: 'C0000000009' },
    ],
    [
      'a non-Slack delivery target falls back to the key',
      slackRow({ deliveryContext: { channel: 'telegram', to: 'user:U42' } }),
      { accountId: 'default', channel: 'C0000000009' },
    ],
    [
      'a Slack row that names no conversation',
      slackRow({ key: 'agent:main:slack:other', channel: 'slack' }),
      { accountId: 'default' },
    ],
  ])('%s', (_name, r, target) => {
    expect(slackNoticeTarget(row(r))).toEqual(target);
  });

  it.each([
    ['the listed main session', row(MAIN_ROW)],
    [
      'a main session whose delivery and origin are Slack',
      row({
        key: 'agent:main:main',
        channel: 'slack',
        deliveryContext: { channel: 'slack', to: 'user:U0000000011' },
        origin: { provider: 'slack', nativeChannelId: 'D0000000011' },
      }),
    ],
    [
      'a Slack key with no origin',
      row({
        channel: 'slack',
        deliveryContext: { channel: 'slack', to: 'channel:C0000000009' },
      }),
    ],
    [
      'a Slack key whose origin is another channel',
      row({ origin: { provider: 'telegram', nativeChannelId: '42' } }),
    ],
    [
      'a non-Slack key with a Slack origin',
      row({
        key: 'agent:main:telegram:direct:42',
        origin: { provider: 'slack', nativeChannelId: 'D0000000012' },
      }),
    ],
  ])('is undefined for %s', (_name, r) => {
    expect(isSlackSession(r)).toBe(false);
    expect(slackNoticeTarget(r)).toBeUndefined();
  });
});

describe('postResetNotice', () => {
  it('posts one line in the channel as the session account', async () => {
    const s = fakeSlack();
    await expect(
      postResetNotice(row(SLACK_CHANNEL_ROW), s.slackFor),
    ).resolves.toBe('posted');
    expect(s.slackFor).toHaveBeenCalledWith('work');
    expect(s.postMessage).toHaveBeenCalledWith(
      'C0000000001',
      NOTICE_TEXT,
      undefined,
    );
    expect(NOTICE_TEXT).not.toContain('\n');
  });

  it('opens the DM when only the user is known, and posts in a thread', async () => {
    const s = fakeSlack();
    await postResetNotice(
      slackRow({ key: 'agent:main:slack:direct:u0000000007' }),
      s.slackFor,
    );
    expect(s.openDm).toHaveBeenCalledWith('U0000000007');
    expect(s.postMessage).toHaveBeenCalledWith(
      'D0000000099',
      NOTICE_TEXT,
      undefined,
    );
    await postResetNotice(
      slackRow({ key: 'agent:main:slack:channel:c1:thread:1.2' }),
      s.slackFor,
    );
    expect(s.postMessage).toHaveBeenLastCalledWith('C1', NOTICE_TEXT, {
      threadTs: '1.2',
    });
  });

  it('posts nothing for a non-Slack session', async () => {
    const s = fakeSlack();
    await expect(postResetNotice(row(MAIN_ROW), s.slackFor)).resolves.toBe(
      'none',
    );
    expect(s.slackFor).not.toHaveBeenCalled();
  });

  it('fails for a Slack session with no conversation, or a failed post', async () => {
    const s = fakeSlack();
    await expect(
      postResetNotice(
        slackRow({ key: 'agent:main:slack:other', channel: 'slack' }),
        s.slackFor,
      ),
    ).rejects.toThrow(
      'no Slack conversation recorded for agent:main:slack:other',
    );
    s.postMessage.mockRejectedValueOnce(new Error('channel_not_found'));
    await expect(postResetNotice(slackRow(), s.slackFor)).rejects.toThrow(
      'channel_not_found',
    );
  });
});
