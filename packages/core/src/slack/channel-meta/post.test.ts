/**
 * Tests for the summary's destination and post: a configured account's
 * bot, else the first workspace whose bot can reach the owner's DM
 * (`default` first), a DM id's first workspace whose bot can see it
 * (read-only lookup; the member listing never holds DMs), a channel's
 * first member workspace, every refusal reported when no bot can reach
 * the target, and a post made only at the destination found.
 */

import { describe, expect, it, vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import { channel, scriptedSlack, workspace } from './fakes.test-helper.js';
import { findDestination, postSummary } from './post.js';
import { readWorkspace, type Workspace } from './workspaces.js';

/** A workspace whose bot can (or can't) open DMs and post. */
const ws = (
  account: string,
  opts: { dm?: string; channels?: string[]; refuse?: Error } = {},
): Workspace => {
  const { client } = scriptedSlack({});
  client.openDm = vi.fn((user: string) =>
    opts.dm === user
      ? Promise.resolve(`D-${account}`)
      : Promise.reject(
          new SlackApiError('conversations.open', 'user_not_found'),
        ),
  );
  client.postMessage = vi.fn((target: string) =>
    opts.refuse === undefined
      ? Promise.resolve({ channel: target, ts: '1.1' })
      : Promise.reject(opts.refuse),
  );
  return workspace(
    account,
    (opts.channels ?? []).map((id) => channel(id, { account })),
    { client },
  );
};

/** The destination's account and conversation. */
const found = async (
  target: string,
  account: string | undefined,
  workspaces: Workspace[],
): Promise<[string, string]> => {
  const d = await findDestination(target, account, workspaces);
  return [d.ws.account, d.channel];
};

describe('findDestination', () => {
  it('finds the workspace whose bot can open a DM with the owner', async () => {
    const a = ws('default');
    const b = ws('vc', { dm: 'U0OWNER' });
    await expect(found('U0OWNER', undefined, [a, b])).resolves.toEqual([
      'vc',
      'D-vc',
    ]);
    expect(a.client.postMessage).not.toHaveBeenCalled();
    expect(b.client.postMessage).not.toHaveBeenCalled();
  });

  it('tries the default workspace first', async () => {
    const a = ws('default', { dm: 'U0OWNER' });
    const b = ws('vc', { dm: 'U0OWNER' });
    await expect(found('U0OWNER', undefined, [a, b])).resolves.toEqual([
      'default',
      'D-default',
    ]);
    expect(b.client.openDm).not.toHaveBeenCalled();
  });

  it('takes a channel from its first member workspace, opening nothing', async () => {
    const a = ws('default');
    const b = ws('vc', { channels: ['C0REPORT'] });
    const c = ws('x', { channels: ['C0REPORT'] });
    await expect(found('C0REPORT', undefined, [a, b, c])).resolves.toEqual([
      'vc',
      'C0REPORT',
    ]);
    expect(b.client.openDm).not.toHaveBeenCalled();
  });

  it('names a channel no bot is a member of', async () => {
    await expect(
      findDestination('C0ELSEWHERE', undefined, [ws('default')]),
    ).rejects.toThrow(
      'no Slack bot can reach C0ELSEWHERE (the bot is not a member of it in any workspace; invite it or set slack.channelMeta.reportAccount)',
    );
  });

  it("uses only the configured account's bot", async () => {
    const a = ws('default', { dm: 'U0OWNER' });
    const b = ws('vc', { dm: 'U0OWNER' });
    await expect(found('U0OWNER', 'vc', [a, b])).resolves.toEqual([
      'vc',
      'D-vc',
    ]);
    expect(a.client.openDm).not.toHaveBeenCalled();
    await expect(found('C0ANY', 'vc', [a, b])).resolves.toEqual([
      'vc',
      'C0ANY',
    ]);
    await expect(findDestination('U0OWNER', 'nope', [a, b])).rejects.toThrow(
      'slack.channelMeta.reportAccount "nope" is not a gateway Slack account',
    );
  });

  it('reports every refusal when no bot can reach the user', async () => {
    const b = ws('vc');
    b.client.openDm = vi.fn(() => Promise.reject(new Error('boom')));
    await expect(
      findDestination('U0OWNER', undefined, [ws('default'), b]),
    ).rejects.toThrow(
      'no Slack bot can reach U0OWNER (default: user_not_found; vc: boom)',
    );
    await expect(findDestination('U0OWNER', undefined, [])).rejects.toThrow(
      'no Slack bot can reach U0OWNER (no Slack accounts)',
    );
  });
});

describe('findDestination: a DM conversation id', () => {
  /** A workspace read through the real listing (public and private
   * channels only), whose bot can see the DM `dm`, if given. */
  const listed = async (account: string, dm?: string) => {
    const { client, calls } = scriptedSlack({
      'auth.test': () => ({ team: account }),
      'users.conversations': () => ({
        channels: [{ id: `C0${account.toUpperCase()}`, name: account }],
      }),
      'conversations.info': (params) => {
        if (params.channel === dm) return { channel: { id: dm, is_im: true } };
        throw new SlackApiError('conversations.info', 'channel_not_found');
      },
    });
    const read = await readWorkspace(account, client, () => undefined);
    return Object.assign(read, { calls });
  };

  it('finds it in the workspace whose bot can see it, opening and posting nothing', async () => {
    const a = await listed('default');
    const b = await listed('vc', 'D0REPORT');
    expect([...a.channels, ...b.channels].map((c) => c.id)).toEqual([
      'C0DEFAULT',
      'C0VC',
    ]);
    await expect(found('D0REPORT', undefined, [a, b])).resolves.toEqual([
      'vc',
      'D0REPORT',
    ]);
    expect(a.calls.at(-1)).toEqual({
      method: 'conversations.info',
      params: { channel: 'D0REPORT' },
    });
    for (const w of [a, b]) {
      expect(w.client.openDm).not.toHaveBeenCalled();
      expect(w.client.postMessage).not.toHaveBeenCalled();
    }
  });

  it('tries the default workspace first', async () => {
    const a = await listed('default', 'D0REPORT');
    const b = await listed('vc', 'D0REPORT');
    await expect(found('D0REPORT', undefined, [a, b])).resolves.toEqual([
      'default',
      'D0REPORT',
    ]);
    expect(b.calls.map((c) => c.method)).not.toContain('conversations.info');
  });

  it('names every refusal when no bot can see it', async () => {
    await expect(
      findDestination('D0REPORT', undefined, [
        await listed('default'),
        await listed('vc'),
      ]),
    ).rejects.toThrow(
      'no Slack bot can reach D0REPORT (default: channel_not_found; vc: channel_not_found)',
    );
  });

  it("takes it as is from a configured account's bot", async () => {
    const a = await listed('default', 'D0REPORT');
    const b = await listed('vc');
    await expect(found('D0REPORT', 'vc', [a, b])).resolves.toEqual([
      'vc',
      'D0REPORT',
    ]);
    for (const w of [a, b])
      expect(w.calls.map((c) => c.method)).not.toContain('conversations.info');
  });
});

describe('postSummary', () => {
  it('posts at the destination and returns its account', async () => {
    const b = ws('vc');
    await expect(postSummary('hi', { ws: b, channel: 'D-vc' })).resolves.toBe(
      'vc',
    );
    expect(b.client.postMessage).toHaveBeenCalledWith('D-vc', 'hi');
  });

  it("names the account and Slack's refusal", async () => {
    await expect(
      postSummary('hi', {
        ws: ws('vc', {
          refuse: new SlackApiError('chat.postMessage', 'channel_not_found'),
        }),
        channel: 'C0X',
      }),
    ).rejects.toThrow(
      'the vc bot could not post the summary to C0X: channel_not_found',
    );
    await expect(
      postSummary('hi', {
        ws: ws('vc', { refuse: new Error('boom') }),
        channel: 'C0X',
      }),
    ).rejects.toThrow('the vc bot could not post the summary to C0X: boom');
  });
});
