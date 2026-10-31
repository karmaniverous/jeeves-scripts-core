/**
 * Tests for gathering a channel with no archive: the history fallback
 * read from the earlier bound, a refusal recorded with the state kept, a
 * read cut at its page cap still advancing the sweep (the channel
 * reported; a second read from the sweep position when the window read
 * fell short of it), and a post whose path can't be read listed by its ts (the
 * error on stderr only).
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SlackApiError } from '../../lib/slack-client.js';
import { channel, human, ts, workspace } from './fakes.test-helper.js';
import { gatherChannel, readHistoryFallback } from './gather.js';
import {
  assignText,
  DAY,
  GATHER_SETTINGS as settings,
  gatherDeps as deps,
  NOW_S,
} from './gather.test-helper.js';
import { type ChannelMessage, compareTs, tsAt } from './messages.js';

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

  it('advances the sweep to the newest message of a cut read from its position', async () => {
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
    expect(history).toHaveBeenCalledTimes(1);
    expect(facts.next).toEqual({
      sweptTs: ts(NOW_S - DAY),
      assignment: { ts: ts(NOW_S - 2 * DAY), path: 'J:/found' },
    });
    expect(facts.lastHumanTs).toBe(ts(NOW_S - DAY));
    expect(facts.sweepNotes).toEqual([
      'history cut at 25 pages: swept up to the newest message read; the next run reads on from there',
    ]);
  });

  it('reads on from the sweep position when a cut window read fell short of it', async () => {
    const sweptTs = ts(NOW_S - 2 * DAY);
    const history = vi.fn((_ws: unknown, _id: string, since?: string) =>
      Promise.resolve(
        since === sweptTs
          ? {
              messages: [
                human(NOW_S - DAY, assignText('j/new')),
                human(NOW_S - 100, 'latest'),
              ],
              truncated: false,
            }
          : { messages: [human(NOW_S - 6 * DAY, 'old')], truncated: true },
      ),
    );
    const facts = await gatherChannel(
      channel('C2'),
      workspace('default', []),
      settings,
      { sweptTs },
      NOW_S * 1000,
      deps({}, { history }),
    );
    expect(history.mock.calls.map((c) => c[2])).toEqual([
      tsAt((NOW_S - 7 * DAY) * 1000),
      sweptTs,
    ]);
    expect(facts.next).toEqual({
      sweptTs: ts(NOW_S - 100),
      assignment: { ts: ts(NOW_S - DAY), path: 'J:/new' },
    });
    expect(facts.recent.map((m) => m.text)).toEqual([
      'old',
      assignText('j/new'),
      'latest',
    ]);
    expect(facts.lastHumanTs).toBe(ts(NOW_S - 100));
    expect(facts.sweepNotes).toEqual([
      'history cut at 25 pages: part of the activity window not read; every new message swept',
    ]);
  });

  it('advances a channel with no position to the newest message of a cut read', async () => {
    const history = read(
      [human(NOW_S - 3 * DAY, 'a'), human(NOW_S - DAY, 'b')],
      true,
    );
    const facts = await gatherChannel(
      channel('C2'),
      workspace('default', []),
      settings,
      {},
      NOW_S * 1000,
      deps({}, { history }),
    );
    expect(history).toHaveBeenCalledWith(expect.anything(), 'C2', undefined);
    expect(facts.next).toEqual({ sweptTs: ts(NOW_S - DAY) });
    expect(facts.sweepNotes).toEqual([
      'history cut at 25 pages: only the newest messages read; older history not swept',
    ]);
  });
});

describe('readHistoryFallback', () => {
  /** A channel of `n` messages, one a second from `t0`, read `cap` at a time forward from a bound (Slack's paging with `oldest`). */
  const busyChannel = (n: number, cap: number, t0: number) => {
    const all = Array.from({ length: n }, (_, i) =>
      human(t0 + i, `m${String(i)}`),
    );
    return vi.fn((since: string | undefined) => {
      const after = all.filter(
        (m) => since === undefined || compareTs(m.ts, since) > 0,
      );
      return Promise.resolve({
        messages: since === undefined ? after.slice(-cap) : after.slice(0, cap),
        truncated: after.length > cap,
      });
    });
  };

  it('makes progress on every run of a channel busier than the cap', async () => {
    const read = busyChannel(10, 4, 1000);
    let swept: string | undefined = ts(999);
    const seen: string[] = [];
    for (let run = 0; run < 3; run += 1) {
      const got = await readHistoryFallback(read, swept, swept);
      seen.push(...got.messages.map((m) => m.text ?? ''));
      swept = got.sweptTo;
    }
    expect(seen).toEqual(Array.from({ length: 10 }, (_, i) => `m${String(i)}`));
    expect(swept).toBe(ts(1009));
  });

  it('keeps the position when a second read finds nothing new', async () => {
    const read = vi.fn((since: string | undefined) =>
      Promise.resolve(
        since === ts(50)
          ? { messages: [], truncated: false }
          : { messages: [human(10, 'old')], truncated: true },
      ),
    );
    await expect(readHistoryFallback(read, ts(5), ts(50))).resolves.toEqual({
      messages: [human(10, 'old')],
      sweptTo: undefined,
      note: 'history cut at 25 pages: part of the activity window not read; every new message swept',
    });
  });

  it('says when the second read is cut too, and merges each message once', async () => {
    const read = vi.fn((since: string | undefined) =>
      Promise.resolve(
        since === ts(50)
          ? { messages: [human(10, 'old'), human(60, 'new')], truncated: true }
          : { messages: [human(10, 'old')], truncated: true },
      ),
    );
    await expect(readHistoryFallback(read, ts(5), ts(50))).resolves.toEqual({
      messages: [human(10, 'old'), human(60, 'new')],
      sweptTo: ts(60),
      note: 'history cut at 25 pages twice: swept up to the newest message read; the next run reads on from there',
    });
  });

  it('treats an empty cut read as contiguous', async () => {
    const read = vi.fn(() =>
      Promise.resolve({ messages: [], truncated: true }),
    );
    await expect(readHistoryFallback(read, ts(5), ts(50))).resolves.toEqual({
      messages: [],
      sweptTo: undefined,
      note: 'history cut at 25 pages: swept up to the newest message read; the next run reads on from there',
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads once from a bound with no sweep position', async () => {
    const read = vi.fn(() =>
      Promise.resolve({ messages: [human(10, 'a')], truncated: true }),
    );
    await expect(readHistoryFallback(read, ts(5), undefined)).resolves.toEqual({
      messages: [human(10, 'a')],
      sweptTo: ts(10),
      note: 'history cut at 25 pages: swept up to the newest message read; the next run reads on from there',
    });
    expect(read).toHaveBeenCalledTimes(1);
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
