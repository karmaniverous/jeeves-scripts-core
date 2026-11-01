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
    const b = ws('globex', { dm: 'U0OWNER' });
    await expect(found('U0OWNER', undefined, [a, b])).resolves.toEqual([
      'globex',
      'D-globex',
    ]);
    expect(a.client.postMessage).not.toHaveBeenCalled();
    expect(b.client.postMessage).not.toHaveBeenCalled();
  });

  it('tries the default workspace first', async () => {
    const a = ws('default', { dm: 'U0OWNER' });
    const b = ws('globex', { dm: 'U0OWNER' });
    await expect(found('U0OWNER', undefined, [a, b])).resolves.toEqual([
      'default',
      'D-default',
    ]);
    expect(b.client.openDm).not.toHaveBeenCalled();
  });

  it('takes a channel from its first member workspace, opening nothing', async () => {
    const a = ws('default');
    const b = ws('globex', { channels: ['C0REPORT'] });
    const c = ws('x', { channels: ['C0REPORT'] });
    await expect(found('C0REPORT', undefined, [a, b, c])).resolves.toEqual([
      'globex',
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
    const b = ws('globex', { dm: 'U0OWNER' });
    await expect(found('U0OWNER', 'globex', [a, b])).resolves.toEqual([
      'globex',
      'D-globex',
    ]);
    expect(a.client.openDm).not.toHaveBeenCalled();
    await expect(found('C0ANY', 'globex', [a, b])).resolves.toEqual([
      'globex',
      'C0ANY',
    ]);
    await expect(findDestination('U0OWNER', 'nope', [a, b])).rejects.toThrow(
      'slack.channelMeta.reportAccount "nope" is not a gateway Slack account',
    );
  });

  it('reports every refusal when no bot can reach the user', async () => {
    const b = ws('globex');
    b.client.openDm = vi.fn(() => Promise.reject(new Error('boom')));
    await expect(
      findDestination('U0OWNER', undefined, [ws('default'), b]),
    ).rejects.toThrow(
      'no Slack bot can reach U0OWNER (default: user_not_found; globex: boom)',
    );
    await expect(findDestination('U0OWNER', undefined, [])).rejects.toThrow(
      'no Slack bot can reach U0OWNER (no Slack accounts)',
    );
  });
});

describe('findDestination: a preview opens no DM', () => {
  /** A workspace whose bot can look up only `user` (read-only). */
  const lookup = (account: string, user?: string) => {
    const { client, calls } = scriptedSlack({
      'users.info': (params) => {
        if (params.user === user) return { user: { id: user } };
        throw new SlackApiError('users.info', 'user_not_found');
      },
    });
    client.openDm = vi.fn(() => Promise.resolve('D0OPENED'));
    return Object.assign(workspace(account, [], { client }), { calls });
  };

  it('finds the user\u2019s workspace with users.info and returns the user id', async () => {
    const a = lookup('default');
    const b = lookup('globex', 'U0OWNER');
    const d = await findDestination('U0OWNER', undefined, [a, b], {
      preview: true,
    });
    expect([d.ws.account, d.channel]).toEqual(['globex', 'U0OWNER']);
    expect(a.calls).toEqual([
      { method: 'users.info', params: { user: 'U0OWNER' } },
    ]);
    for (const w of [a, b]) expect(w.client.openDm).not.toHaveBeenCalled();
  });

  it('takes a configured account as is, calling nothing', async () => {
    const a = lookup('default');
    const d = await findDestination('U0OWNER', 'default', [a], {
      preview: true,
    });
    expect([d.ws.account, d.channel]).toEqual(['default', 'U0OWNER']);
    expect(a.calls).toEqual([]);
    expect(a.client.openDm).not.toHaveBeenCalled();
  });

  it('reports each lookup refusal when no bot knows the user', async () => {
    await expect(
      findDestination('U0OWNER', undefined, [lookup('default')], {
        preview: true,
      }),
    ).rejects.toThrow(
      'no Slack bot can reach U0OWNER (default: user_not_found)',
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
    const b = await listed('globex', 'D0REPORT');
    expect([...a.channels, ...b.channels].map((c) => c.id)).toEqual([
      'C0DEFAULT',
      'C0GLOBEX',
    ]);
    await expect(found('D0REPORT', undefined, [a, b])).resolves.toEqual([
      'globex',
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
    const b = await listed('globex', 'D0REPORT');
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
        await listed('globex'),
      ]),
    ).rejects.toThrow(
      'no Slack bot can reach D0REPORT (default: channel_not_found; globex: channel_not_found)',
    );
  });

  it("takes it as is from a configured account's bot", async () => {
    const a = await listed('default', 'D0REPORT');
    const b = await listed('globex');
    await expect(found('D0REPORT', 'globex', [a, b])).resolves.toEqual([
      'globex',
      'D0REPORT',
    ]);
    for (const w of [a, b])
      expect(w.calls.map((c) => c.method)).not.toContain('conversations.info');
  });
});

describe('postSummary', () => {
  it('posts at the destination and returns its account', async () => {
    const b = ws('globex');
    await expect(
      postSummary('hi', { ws: b, channel: 'D-globex' }),
    ).resolves.toBe('globex');
    expect(b.client.postMessage).toHaveBeenCalledWith('D-globex', 'hi');
  });

  it("names the account and Slack's refusal", async () => {
    await expect(
      postSummary('hi', {
        ws: ws('globex', {
          refuse: new SlackApiError('chat.postMessage', 'channel_not_found'),
        }),
        channel: 'C0X',
      }),
    ).rejects.toThrow(
      'the globex bot could not post the summary to C0X: channel_not_found',
    );
    await expect(
      postSummary('hi', {
        ws: ws('globex', { refuse: new Error('boom') }),
        channel: 'C0X',
      }),
    ).rejects.toThrow('the globex bot could not post the summary to C0X: boom');
  });
});
