/**
 * Tests for gathering a channel with no archive: the history fallback
 * read from the earlier bound, a refusal recorded with the state kept, a
 * read cut at its page cap keeping the sweep position (the channel
 * reported), and a post whose path can't be read listed by its ts (the
 * error on stderr only).
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import { channel, human, ts, workspace } from './fakes.test-helper.js';
import { gatherChannel } from './gather.js';
import {
  assignText,
  DAY,
  GATHER_SETTINGS as settings,
  gatherDeps as deps,
  NOW_S,
} from './gather.test-helper.js';
import type { ChannelMessage } from './messages.js';

const read = (messages: ChannelMessage[], truncated = false) =>
  vi.fn(() => Promise.resolve({ messages, truncated }));

describe('gatherChannel: history fallback', () => {
  it('falls back to history without an archive, from the earlier bound', async () => {
    const history = read([human(NOW_S - DAY, 'hi')]);
    const ws = workspace('globex', []);
    const facts = await gatherChannel(
      channel('C2', { account: 'globex' }),
      ws,
      settings,
      { sweptTs: ts(NOW_S - 30 * DAY) },
      NOW_S * 1000,
      deps({}, { history }),
    );
    expect(history).toHaveBeenCalledWith(ws, 'C2', ts(NOW_S - 30 * DAY));
    expect(facts.lastHumanTs).toBe(ts(NOW_S - DAY));
    expect(facts.next.sweptTs).toBe(ts(NOW_S - DAY));
    expect(facts).not.toHaveProperty('sweepNotes');
  });

  it('records a history refusal and keeps the state as it was', async () => {
    const history = vi.fn(() =>
      Promise.reject(
        new SlackApiError('conversations.history', 'missing_scope'),
      ),
    );
    const state = { sweptTs: ts(1) };
    const facts = await gatherChannel(
      channel('C2'),
      workspace('default', []),
      settings,
      state,
      NOW_S * 1000,
      deps({}, { history }),
    );
    expect(facts.readError).toBe(
      'Slack conversations.history failed: missing_scope',
    );
    expect(facts.next).toEqual(state);
  });

  it('keeps the sweep position when the read was cut, but uses what it read', async () => {
    const history = read(
      [human(NOW_S - 2 * DAY, assignText('j/found')), human(NOW_S - DAY, 'hi')],
      true,
    );
    const state = { sweptTs: ts(NOW_S - 30 * DAY) };
    const facts = await gatherChannel(
      channel('C2'),
      workspace('default', []),
      settings,
      state,
      NOW_S * 1000,
      deps({}, { history }),
    );
    expect(facts.next).toEqual({
      sweptTs: ts(NOW_S - 30 * DAY),
      assignment: { ts: ts(NOW_S - 2 * DAY), path: 'J:/found' },
    });
    expect(facts.lastHumanTs).toBe(ts(NOW_S - DAY));
    expect(facts.sweepNotes).toEqual([
      'history cut at 25 pages: sweep position kept',
    ]);
  });

  it('lists a post whose path can\u2019t be read and sweeps on', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const host = {
      ...path.win32,
      get sep(): typeof path.sep {
        throw new Error('bad root');
      },
    };
    const history = read([
      human(NOW_S - 2 * DAY, assignText('j/x')),
      human(NOW_S - DAY, 'hi'),
    ]);
    const facts = await gatherChannel(
      channel('C2'),
      workspace('default', []),
      { ...settings, pathRoots: { roots: { j: 'J:/' }, host } },
      {},
      NOW_S * 1000,
      deps({}, { history }),
    );
    expect(facts.sweepNotes).toEqual([
      `post ${ts(NOW_S - 2 * DAY)}: path unreadable (details in the job log)`,
    ]);
    expect(stderr).toHaveBeenCalledWith(
      `[warn] slack/refresh-channel-meta: post ${ts(NOW_S - 2 * DAY)} in C2: path unreadable: bad root`,
    );
    expect(facts.next).toEqual({ sweptTs: ts(NOW_S - DAY) });
    stderr.mockRestore();
  });
});
