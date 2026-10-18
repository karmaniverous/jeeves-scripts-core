/**
 * Slack poller backlogs (karmaniverous/jeeves-scripts-core#37): read
 * positions saved per message, the per-channel budget, the new-channel
 * lookback and channels Slack no longer shows. Fixture: `poll.test-helper`.
 */

import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { pollSlack } from './poll.js';
import { usePollFixture } from './poll.test-helper.js';

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sleepAsync: () => Promise.resolve(),
}));

const { api, deps, fake, histories, runner } = usePollFixture();

/**
 * C1 history: `n` top-level messages (ts `200.000001` up). Like Slack given
 * `oldest` and no `latest`: the `limit` messages just after `oldest`,
 * newest first, and `has_more` when newer ones remain.
 */
const backlog = (
  n: number,
  extra: Record<string, unknown> = {},
  onFetch?: () => void,
) => {
  api['conversations.history'] = (q) => {
    if (q.get('channel') !== 'C1') return { ok: true, messages: [] };
    onFetch?.();
    const oldest = Number(q.get('oldest'));
    const after = Array.from({ length: n }, (_, i) => ({
      ts: `${String(200 + i)}.000001`,
      user: 'U1',
      text: `m${String(i)}`,
      ...extra,
    })).filter((m) => Number(m.ts) > oldest);
    const limit = Number(q.get('limit'));
    return {
      ok: true,
      messages: after.slice(0, limit).reverse(),
      has_more: after.length > limit,
    };
  };
};

/** Record every C1 read position written to runner state. */
const recordSaves = (failOn?: number) => {
  const saves: string[] = [];
  const client = runner().client;
  const setState = client.setState.bind(client);
  client.setState = (ns, key, value) => {
    if (key === 'lastTs-C1') {
      saves.push(value);
      if (saves.length === failOn) throw new Error('killed');
    }
    setState(ns, key, value);
  };
  return { saves, restore: () => (client.setState = setState) };
};

const oldestFor = (channel: string) =>
  histories()
    .filter((u) => u.searchParams.get('channel') === channel)
    .map((u) => u.searchParams.get('oldest'));

describe('pollSlack backlogs', () => {
  it('saves the read position after each message, oldest first, so a killed run resumes there', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    backlog(5);
    const { saves, restore } = recordSaves(3);
    await expect(pollSlack(deps())).rejects.toThrow(
      'Slack read positions unavailable',
    );
    expect(saves).toEqual(['200.000001', '201.000001', '202.000001']);
    expect(runner().state.get('slack|lastTs-C1')).toBe('201.000001');

    restore();
    fake().calls.length = 0;
    await pollSlack(deps());
    expect(oldestFor('C1')).toEqual(['201.000001']);
    expect(runner().state.get('slack|lastTs-C1')).toBe('204.000001');
  });

  it('never saves a reply ts, even when it is newer than unread messages', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    backlog(3, { reply_count: 1 });
    api['conversations.replies'] = (q) => ({
      ok: true,
      messages: [
        { ts: q.get('ts') },
        { ts: '999.000001', user: 'U1', text: 'late reply' },
      ],
    });
    const { saves } = recordSaves();
    await pollSlack(deps());
    expect(saves).toEqual(['200.000001', '201.000001', '202.000001']);
  });

  it('stops a channel at its budget, logs the backfill and still polls the channels after it', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    backlog(10);
    api['conversations.list'] = () => ({
      ok: true,
      channels: [
        { id: 'C1', name: 'general', is_member: true },
        { id: 'C3', name: 'after', is_member: true },
      ],
    });
    let clock = 0;
    await pollSlack(deps({ now: () => (clock += 20_000) }));
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^backfilling C1 \(general\): \d+ written, resuming next run$/,
      ),
    );
    expect(runner().state.get('slack|lastTs-C1')).toBe('202.000001');
    expect(oldestFor('C3')).toHaveLength(1);
  });

  it('reads a long history a page at a time, stops at the budget between pages and resumes there', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    api['conversations.list'] = () => ({
      ok: true,
      channels: [
        { id: 'C1', name: 'general', is_member: true },
        { id: 'C3', name: 'after', is_member: true },
      ],
    });
    // The clock moves only while history is fetched: 30 s a page against a
    // 60 s budget, so page 1 is read and page 2 is fetched but not started.
    let clock = 0;
    backlog(450, {}, () => (clock += 30_000));
    const run = deps({ now: () => clock });
    await pollSlack(run);
    expect(oldestFor('C1')).toEqual(['0', '399.000001']);
    expect(runner().state.get('slack|lastTs-C1')).toBe('399.000001');
    // (The suite shares one archive, so earlier tests' files count as old.)
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^backfilling C1 \(general\): \d+ written, resuming next run$/,
      ),
    );
    expect(oldestFor('C3')).toHaveLength(1);

    fake().calls.length = 0;
    clock = 0;
    vi.mocked(console.log).mockClear();
    await pollSlack(run);
    expect(oldestFor('C1')).toEqual(['399.000001', '599.000001']);
    expect(runner().state.get('slack|lastTs-C1')).toBe('599.000001');

    fake().calls.length = 0;
    clock = 0;
    vi.mocked(console.log).mockClear();
    await pollSlack(run);
    expect(oldestFor('C1')).toEqual(['599.000001']);
    expect(runner().state.get('slack|lastTs-C1')).toBe('649.000001');
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringMatching(/^backfilling/),
    );
  });

  it('always makes progress, even with a budget already spent', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    backlog(3);
    let clock = 0;
    await pollSlack(deps({ now: () => (clock += 1_000_000) }));
    expect(runner().state.get('slack|lastTs-C1')).toBe('200.000001');
  });

  it('starts a channel with no read position at the configured lookback and keeps that start while it is quiet', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    api['conversations.history'] = () => ({ ok: true, messages: [] });
    const config = () => ({
      backfillBudgetSeconds: 60,
      newChannelLookbackDays: 0,
    });
    const start = 1_000_000_000_000;
    await pollSlack(deps({ now: () => start, config }));
    const seeded = `${String(start / 1000)}.000000`;
    expect(oldestFor('C1')).toEqual([seeded]);
    expect(runner().state.get('slack|lastTs-C1')).toBe(seeded);

    // An hour later the channel is still read from where it was first seen,
    // so a message posted between the runs is not skipped.
    fake().calls.length = 0;
    await pollSlack(deps({ now: () => start + 3_600_000, config }));
    expect(oldestFor('C1')).toEqual([seeded]);
  });

  it('applies a lookback in days, never before the epoch', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    api['conversations.history'] = () => ({ ok: true, messages: [] });
    const now = 1_000_000_000_000;
    const lookback = (days: number) => () => ({
      backfillBudgetSeconds: 60,
      newChannelLookbackDays: days,
    });
    await pollSlack(deps({ now: () => now, config: lookback(2) }));
    expect(oldestFor('C1')).toEqual([
      `${String(now / 1000 - 2 * 86_400)}.000000`,
    ]);

    fake().calls.length = 0;
    runner().state.clear();
    await pollSlack(deps({ now: () => now, config: lookback(1e9) }));
    expect(oldestFor('C1')).toEqual(['0.000000']);
  });

  it('reads a channel with no read position and no lookback from the beginning', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    api['conversations.history'] = () => ({ ok: true, messages: [] });
    await pollSlack(deps());
    expect(oldestFor('C1')).toEqual(['0']);
    expect(runner().state.get('slack|lastTs-C1')).toBeUndefined();
  });

  it('logs a channel Slack no longer shows as a skip, not an error', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    api['conversations.history'] = (q) =>
      q.get('channel') === 'C2'
        ? { ok: false, error: 'channel_not_found' }
        : { ok: true, messages: [] };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await pollSlack(deps());
    expect(warn).toHaveBeenCalledWith(
      'SKIP C2: Slack conversations.history failed: channel_not_found',
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});
