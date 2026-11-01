/**
 * Tests for the flow's previews and guards: a run without `--live` (the worker
 * dispatched for real, its result checked, current vs proposed in the
 * run directory's `preview.md`; no set, dated report, post or state) and
 * `--print-task` (TASK only, no worker; summary and report logged),
 * a missing link (a preview warns, a live run fails before any worker),
 * the batch cap, run-directory pruning, and incomplete settings.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { channel } from './fakes.test-helper.js';
import { PREVIEW_FILE, refreshChannelMeta } from './refresh.js';
import {
  DRY,
  GOOD,
  harness as runHarness,
  LINK,
  LIVE,
  REPORT_FILE,
} from './refresh.test-helper.js';
import { KEEP_RUNS, PRINT_TASK_FLAGS, WORKER_FLAGS } from './worker-batch.js';

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

/** The only run directory. */
const runDir = (): string => {
  const runs = fs.readdirSync(runsRoot);
  expect(runs).toHaveLength(1);
  return path.join(runsRoot, runs[0] ?? '');
};

const readPreview = (): string =>
  fs.readFileSync(path.join(runDir(), PREVIEW_FILE), 'utf8');

/** C1 already has a description, and a topic equal to the worker's. */
const described = [
  channel('C1', { name: 'one', purpose: 'Old purpose', topic: 'Now: one' }),
  channel('C2', { name: 'two' }),
];

const expectNothingDelivered = (h: ReturnType<typeof harness>): void => {
  expect(h.apply).not.toHaveBeenCalled();
  expect(h.posts).toEqual([]);
  expect(h.delivered).toEqual([]);
  expect(h.saved).toEqual([]);
};

describe('refreshChannelMeta: without --live', () => {
  it('dispatches the worker for real and writes current vs proposed to the run directory, setting nothing', async () => {
    const h = harness({ channels: described, result: () => GOOD });
    expect(await refreshChannelMeta(DRY, h.deps)).toBe('previewed');
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0]?.[0]).toContain('- `C1`');
    expect(h.dispatch.mock.calls[0]?.[1]).toEqual(WORKER_FLAGS);
    expectNothingDelivered(h);
    const file = path.join(runDir(), PREVIEW_FILE);
    expect(h.logs[1]).toBe(
      `slack/refresh-channel-meta: preview: nothing set; report ${file} (a live run writes ${REPORT_FILE}, config); this summary would go to U0OWNER (config; channel text shown for: default):`,
    );
    const summary = h.logs[2] ?? '';
    expect(summary).toContain('(2027-01-14) \u2014 preview: nothing set');
    expect(summary).toContain(
      'Descriptions: 1 proposed, 0 unchanged, 0 pending, 0 failed',
    );
    expect(summary).toContain(
      'Topics: 0 proposed, 1 unchanged, 0 pending, 0 failed',
    );
    expect(summary).toContain(`Report: ${LINK}`);
    expect(h.logs).toHaveLength(3);
    const report = readPreview();
    expect(report).toContain('(2027-01-14)');
    expect(report).toContain(
      "node bin/jeeves-scripts.js config set slack.channels.C2.homeDir '/home/c2'",
    );
    expect(report).toContain(
      '**Proposed (preview: not set)** (1):\n\n- #one (`C1`): new\n  - current: \u201cOld purpose\u201d\n  - proposed: \u201cAbout one\u201d',
    );
    expect(report).toContain(
      '**Generated, already current (not written)** (1):\n\n- #one (`C1`) \u2014 \u201cNow: one\u201d',
    );
  });

  it('shows an empty current value as (empty)', async () => {
    const h = harness({ result: () => GOOD });
    await refreshChannelMeta(DRY, h.deps);
    expect(readPreview()).toContain(
      '- #one (`C1`): empty\n  - current: (empty)\n  - proposed: \u201cAbout one\u201d',
    );
  });

  it('ends partial (exit 1) on an invalid result, setting nothing', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const h = harness({ result: () => '{"channels": {"C1": 3}}' });
    expect(await refreshChannelMeta(DRY, h.deps)).toBe('partial');
    expectNothingDelivered(h);
    expect(readPreview()).toContain(
      "No values set: the worker's result does not match the contract (1 issue); details in worker-problem.txt",
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('channels.C1: Invalid input'),
    );
    stderr.mockRestore();
    expect(h.logs[2]).toContain('Worker result unusable: no values set');
  });

  it('names values the contract rejects', async () => {
    const h = harness({
      result: () =>
        JSON.stringify({ channels: { C1: { description: 'a\nb' } } }),
    });
    await refreshChannelMeta(DRY, h.deps);
    const report = readPreview();
    expect(report).toContain(
      '**Worker value rejected** (1):\n\n- #one (`C1`): more than one line',
    );
    expect(report).toContain('- #one (`C1`): not written');
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('writes the preview even when no channel needs text', async () => {
    const h = harness({ channels: [channel('C2', { name: 'two' })] });
    expect(await refreshChannelMeta(DRY, h.deps)).toBe('previewed');
    expect(h.dispatch).not.toHaveBeenCalled();
    expectNothingDelivered(h);
    expect(readPreview()).toContain('## Descriptions\n\nNo changes.');
  });
});

describe('refreshChannelMeta: previews and guards', () => {
  it('previews on --print-task even with --live: nothing set or delivered', async () => {
    const h = harness({ result: () => GOOD });
    expect(
      await refreshChannelMeta({ live: true, printTask: true }, h.deps),
    ).toBe('previewed');
    expect(h.dispatch.mock.calls[0]?.[1]).toEqual(PRINT_TASK_FLAGS);
    expectNothingDelivered(h);
  });

  it('prints the TASK on --print-task without a worker; summary and report logged, nothing delivered', async () => {
    const flags = { live: false, printTask: true };
    const h = harness({ result: () => GOOD });
    expect(await refreshChannelMeta(flags, h.deps)).toBe('previewed');
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0]?.[0]).toContain('- `C1`');
    expect(h.dispatch.mock.calls[0]?.[1]).toEqual(PRINT_TASK_FLAGS);
    expectNothingDelivered(h);
    expect(h.logs[0]).toContain(
      '2 member channel(s) in 1 workspace(s); 1 need text, 1 sent to the worker',
    );
    expect(h.logs[1]).toBe(
      `slack/refresh-channel-meta: preview only; the report would go to ${REPORT_FILE} (config) and this summary to U0OWNER (config; channel text shown for: default):`,
    );
    const summary = h.logs[2] ?? '';
    expect(summary).toContain('(2027-01-14) \u2014 preview: nothing set');
    expect(summary).toContain(
      'Descriptions: 0 proposed, 0 unchanged, 1 pending, 0 failed',
    );
    const report = h.logs[3] ?? '';
    expect(report).toContain(
      '**Would generate (preview)** (1):\n\n- #one (`C1`): empty',
    );
    expect(fs.existsSync(path.join(runDir(), 'channels', 'C1.md'))).toBe(true);
    expect(fs.existsSync(path.join(runDir(), PREVIEW_FILE))).toBe(false);
  });

  it('previews with a warning when the report cannot be linked', async () => {
    const h = harness({
      link: () => Promise.reject(new Error('HTTP 404')),
      result: () => GOOD,
    });
    expect(await refreshChannelMeta(DRY, h.deps)).toBe('previewed');
    expect(h.logs[0]).toBe(
      `[warn] slack/refresh-channel-meta: no insider link for ${REPORT_FILE}; the live run would fail: HTTP 404`,
    );
    expect(h.logs.join('\n')).toContain('Report: (no link)');
  });

  it('fails a live run without a link before spending a worker', async () => {
    const h = harness({ link: () => Promise.reject(new Error('HTTP 404')) });
    await expect(refreshChannelMeta(LIVE, h.deps)).rejects.toThrow('HTTP 404');
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.saved).toEqual([]);
  });

  it('caps the batch and defers the rest', async () => {
    const h = harness({
      block: { maxChannels: 1 },
      channels: [
        channel('C1', { name: 'one' }),
        channel('C3', { name: 'three' }),
      ],
    });
    h.deps.homeDirOf = (id) => (id === 'C2' ? undefined : '/home/c1');
    await refreshChannelMeta(DRY, h.deps);
    expect(readPreview()).toContain(
      '**Waiting for a later run (batch cap)** (1):\n\n- #three (`C3`)',
    );
    const task = h.dispatch.mock.calls[0]?.[0] ?? '';
    expect(task).toContain('- `C1`');
    expect(task).not.toContain('- `C3`');
  });

  it('keeps only the newest run directories on a live run', async () => {
    for (let i = 0; i < KEEP_RUNS + 2; i += 1)
      fs.mkdirSync(
        path.join(runsRoot, `20200101-0000${String(i).padStart(2, '0')}`),
      );
    await refreshChannelMeta(LIVE, harness({ result: () => GOOD }).deps);
    expect(fs.readdirSync(runsRoot)).toHaveLength(KEEP_RUNS);
    expect(fs.readdirSync(runsRoot)).not.toContain('20200101-000000');
  });

  it.each([
    ['a preview', DRY],
    ['--print-task', { live: true, printTask: true }],
  ])('deletes no run directory on %s', async (_name, flags) => {
    for (let i = 0; i < KEEP_RUNS + 2; i += 1)
      fs.mkdirSync(
        path.join(runsRoot, `20200101-0000${String(i).padStart(2, '0')}`),
      );
    await refreshChannelMeta(flags, harness({ result: () => GOOD }).deps);
    expect(fs.readdirSync(runsRoot)).toHaveLength(KEEP_RUNS + 3);
  });

  it('fails on incomplete settings before reading anything', async () => {
    const h = harness();
    h.deps.settings = () => ({ problem: 'set it' });
    const workspaces = vi.spyOn(h.deps, 'workspaces');
    await expect(refreshChannelMeta(DRY, h.deps)).rejects.toThrow('set it');
    expect(workspaces).not.toHaveBeenCalled();
  });
});
