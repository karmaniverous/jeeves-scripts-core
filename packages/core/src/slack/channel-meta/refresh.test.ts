/**
 * Tests for a live run with injected side effects: the worker's values
 * applied (a hand-written value overwritten, an identical one not
 * written), the dated report written (zoned date) and the numbers-only
 * summary posted with the link, state saved before delivery, the posting
 * account passed through, report-only settings, a missing result
 * (partial), a quiet day, an unreadable state stopping the run before
 * Slack, and a fair batch across runs when more channels need text than
 * the cap.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  channel,
  human,
  messageJson,
  ts,
  workspace,
} from './fakes.test-helper.js';
import { META } from './gather.test-helper.js';
import { refreshChannelMeta } from './refresh.js';
import {
  GOOD,
  harness as runHarness,
  LINK,
  LIVE,
  NOW_S,
  REPORT_ONLY,
} from './refresh.test-helper.js';
import type { JobState } from './state.js';

let runsRoot = '';

beforeEach(() => {
  runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-meta-runs-'));
  // An unusable worker result's diagnostic goes to stderr.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

const harness = (over?: Parameters<typeof runHarness>[1]) =>
  runHarness(runsRoot, over);

describe('refreshChannelMeta: live runs', () => {
  it('applies the worker\u2019s values, writes the report, posts the summary, and saves state before delivering', async () => {
    const h = harness({ result: () => GOOD });
    const record = h.deps.post;
    h.deps.post = (text, destination) => {
      expect(h.saved).toHaveLength(1);
      return record(text, destination);
    };
    expect(await refreshChannelMeta(LIVE, h.deps)).toBe('posted');
    expect(h.apply.mock.calls.map((c) => [c[1], c[2], c[3]])).toEqual([
      ['C1', 'description', 'About one'],
      ['C1', 'topic', 'Now: one'],
    ]);
    expect(h.delivered).toHaveLength(1);
    const { outputDir, date, text } = h.delivered[0] ?? {};
    expect([outputDir, date]).toEqual(['/out', '2027-01-14']);
    expect(text).toContain(
      '**Updated** (1):\n\n- #one (`C1`) \u2014 \u201cAbout one\u201d',
    );
    expect(h.posts.map((p) => [p.target, p.account])).toEqual([
      ['D0DM', 'default'],
    ]);
    const post = h.posts[0]?.text ?? '';
    expect(post).toContain(
      'Descriptions: 1 updated, 0 unchanged, 0 pending, 0 failed',
    );
    expect(post).toContain(`Report: ${LINK}`);
    expect(post).not.toContain('About one');
    expect(post).not.toContain('#one');
    expect(h.saved).toHaveLength(2);
    expect(h.saved[0]?.reportHash).toBeUndefined();
    expect(h.saved[0]?.channels.C1?.description).toEqual({
      generatedAt: '2026-10-01T00:00:00Z',
      checkedAt: new Date(NOW_S * 1000).toISOString(),
    });
    expect(h.saved[0]?.channels.C2?.assignment).toEqual({
      ts: ts(NOW_S - 3600),
      path: '/home/c2',
    });
    expect(h.saved[1]?.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.logs.at(-1)).toBe(
      'slack/refresh-channel-meta: report /out/2027-01-14.md; summary posted to U0OWNER by default',
    );
  });

  it('stops before any Slack call when the state can\u2019t be read', async () => {
    const h = harness({ result: () => GOOD });
    const workspaces = vi.fn(h.deps.workspaces);
    h.deps.workspaces = workspaces;
    h.deps.loadState = () => {
      throw Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
    };
    await expect(refreshChannelMeta(LIVE, h.deps)).rejects.toThrow('EACCES');
    expect(workspaces).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.posts).toEqual([]);
    expect(h.saved).toEqual([]);
  });

  it('passes the configured posting account through', async () => {
    const h = harness({
      block: { ...REPORT_ONLY, reportAccount: 'vc' },
      workspaces: () => [workspace('default', []), workspace('vc', [])],
    });
    await refreshChannelMeta(LIVE, h.deps);
    expect(h.posts[0]?.account).toBe('vc');
  });

  it('overwrites a hand-written value and leaves an identical one unwritten', async () => {
    const h = harness({
      result: () =>
        JSON.stringify({
          channels: { C1: { description: 'Same as now', topic: 'New topic' } },
        }),
      channels: [
        channel('C1', {
          name: 'one',
          purpose: 'Same as now',
          topic: 'Typed by a person',
        }),
      ],
    });
    await refreshChannelMeta(LIVE, h.deps);
    expect(h.apply.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      ['topic', 'New topic'],
    ]);
    expect(h.posts[0]?.text).toContain(
      'Descriptions: 0 updated, 1 unchanged, 0 pending, 0 failed',
    );
    expect(h.saved[0]?.channels.C1?.description?.checkedAt).toBeDefined();
  });

  it('is quiet when the report has not changed since the last one delivered', async () => {
    const first = harness({ block: REPORT_ONLY });
    await refreshChannelMeta(LIVE, first.deps);
    expect(first.dispatch).not.toHaveBeenCalled();
    const again = harness({ block: REPORT_ONLY, state: first.saved.at(-1) });
    expect(await refreshChannelMeta(LIVE, again.deps)).toBe('quiet');
    expect(again.posts).toEqual([]);
    expect(again.delivered).toEqual([]);
    expect(again.saved).toHaveLength(1);
    expect(again.logs.at(-1)).toContain(
      '[skip] slack/refresh-channel-meta: report unchanged',
    );
  });

  it('reports only when updates are switched off', async () => {
    const h = harness({ block: REPORT_ONLY });
    expect(await refreshChannelMeta(LIVE, h.deps)).toBe('posted');
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.delivered[0]?.text).toContain(
      '## Descriptions\n\nSwitched off: report only.',
    );
    expect(h.posts[0]?.text).toContain('Descriptions: off (report only)');
  });

  it('ends partial, sets nothing and says why when the worker wrote no result', async () => {
    const h = harness();
    expect(await refreshChannelMeta(LIVE, h.deps)).toBe('partial');
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.delivered[0]?.text).toContain(
      '## Worker\n\nNo values set: the worker wrote no result',
    );
    expect(h.posts[0]?.text).toContain('Worker result unusable');
    const again = harness({ state: h.saved.at(-1) });
    expect(await refreshChannelMeta(LIVE, again.deps)).toBe('partial');
    expect(again.posts).toEqual([]);
  });
});

describe('refreshChannelMeta: batch fairness', () => {
  const NAMES = ['a', 'b', 'c', 'd', 'e'];
  const id = (name: string) => `C${name.toUpperCase()}`;
  /** Every channel seeded, with a person posting an hour before the run. */
  const busyRun = (nowS: number, state: JobState | undefined) =>
    harness({
      nowS,
      ...(state ? { state } : {}),
      block: { maxChannels: 2 },
      channels: NAMES.map((n) => channel(id(n), { name: n })),
      homeDirOf: (c) => `/home/${c}`,
      files: Object.fromEntries(
        NAMES.flatMap((n) => [
          [`/home/${id(n)}/.meta/meta.json`, META],
          [
            `/arch/${n} (${id(n)})/${ts(nowS - 3600)}.json`,
            messageJson(human(nowS - 3600, 'still busy')),
          ],
        ]),
      ),
      result: () =>
        JSON.stringify({
          channels: Object.fromEntries(
            NAMES.map((n) => [
              id(n),
              { description: `About ${n}`, topic: `Now ${String(nowS)}` },
            ]),
          ),
        }),
    });

  it('serves every continuously active channel within a few runs, least recently processed first', async () => {
    let state: JobState | undefined;
    const batches: string[][] = [];
    for (let run = 0; run < 4; run += 1) {
      const h = busyRun(NOW_S + run * 86_400, state);
      expect(await refreshChannelMeta(LIVE, h.deps)).toBe('posted');
      batches.push([...new Set(h.apply.mock.calls.map((c) => c[1]))]);
      expect(h.delivered[0]?.text).toContain(
        '**Waiting for a later run (batch cap)** (3):',
      );
      state = h.saved.at(-1);
    }
    expect(batches).toEqual([
      ['CA', 'CB'],
      ['CC', 'CD'],
      ['CE', 'CA'],
      ['CB', 'CC'],
    ]);
  });
});
