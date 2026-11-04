/**
 * Tests for the `admin-refresh-sessions` runnable over faked live
 * collaborators: its declaration (id, `--live`, doctor check), a dry run
 * by default, exit code 1 after a failed reset, and the agent DBs closed
 * whether the run succeeds or throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCoreManifests } from '../runnables/manifest.js';
import { row, turn } from './lib/session-refresh.fixtures.js';
import type * as LiveModule from './lib/session-refresh-live.js';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<
    (method: string, params?: Record<string, unknown>) => Promise<unknown>
  >(),
  close: vi.fn(),
  usage: vi.fn(),
  settings: vi.fn(),
  doctor: vi.fn(() => Promise.resolve(true as const)),
  notice: vi.fn(() => Promise.resolve('none' as const)),
}));

vi.mock('./lib/session-refresh-notice.js', () => ({
  postResetNotice: mocks.notice,
}));

vi.mock(
  './lib/session-refresh-live.js',
  async (importOriginal: () => Promise<typeof LiveModule>) => ({
    ...(await importOriginal()),
    liveRpc: mocks.rpc,
    liveSettings: mocks.settings,
    openUsageReader: () => ({ usage: mocks.usage, close: mocks.close }),
    sessionRefreshDoctorCheck: mocks.doctor,
  }),
);

import { liveSlack } from './lib/session-refresh-live.js';
import job, {
  runSessionRefresh,
  sessionRefreshFlags,
} from './session-refresh.js';

const due = row({ key: 'agent:main:main', sessionId: 'm', channel: null });

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.settings.mockReturnValue({
    contextThreshold: 100,
    idleMinutes: 60,
    excludedKeys: new Set<string>(),
  });
  mocks.usage.mockReturnValue(turn({ cacheRead: 500 }));
  mocks.rpc.mockImplementation((method, params) => {
    if (method === 'sessions.list')
      return Promise.resolve({ sessions: params?.activeOnly ? [] : [due] });
    if (method === 'sessions.describe')
      return Promise.resolve({ session: due });
    return Promise.reject(new Error('reset refused'));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('admin-refresh-sessions', () => {
  it('is the admin runnable with a --live flag and a doctor check', async () => {
    expect(job.id).toBe('admin-refresh-sessions');
    expect(job.domain).toBe('admin');
    expect(job.name).toBe('session-refresh');
    expect(sessionRefreshFlags.live).toBeDefined();
    await expect(job.doctorCheck?.({ args: [] })).resolves.toBe(true);
    expect(mocks.doctor).toHaveBeenCalled();
  });

  it('ships disabled, a dry run every 23 minutes with no arguments', () => {
    const manifest = readCoreManifests().find(
      (m) => m.id === 'admin-refresh-sessions',
    );
    expect(manifest).toMatchObject({
      domain: 'admin',
      enabled: false,
      schedule: { freq: 'minutely', interval: 23, timezone: 'UTC' },
      overlap_policy: 'skip',
      timeout_seconds: 300,
      prerequisite: null,
    });
    expect(manifest).not.toHaveProperty('args');
  });

  it('runs dry by default: lists, never resets, exits 0, closes the DBs', async () => {
    await job.run({ args: [] });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual(['sessions.list']);
    expect(process.exitCode).toBeUndefined();
    expect(mocks.close).toHaveBeenCalled();
  });

  it('closes the agent DBs after selection, before the first live re-check', async () => {
    await job.run({ args: ['--live'] });
    const describeAt = mocks.rpc.mock.calls.findIndex(
      (c) => c[0] === 'sessions.describe',
    );
    expect(mocks.usage).toHaveBeenCalledTimes(1);
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[describeAt]!,
    );
  });

  it('resets with --live, and sets exit code 1 after a failed reset', async () => {
    await job.run({ args: ['--live'] });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual([
      'sessions.list',
      'sessions.describe',
      'sessions.list',
      'sessions.reset',
    ]);
    expect(mocks.rpc.mock.calls[2]?.[1]).toMatchObject({ activeOnly: true });
    expect(process.exitCode).toBe(1);
  });

  it("leaves exit code 0 after a successful live reset and posts the notice with the account's Slack client", async () => {
    mocks.rpc.mockImplementation((method, params) => {
      if (method === 'sessions.list')
        return Promise.resolve({ sessions: params?.activeOnly ? [] : [due] });
      if (method === 'sessions.describe')
        return Promise.resolve({ session: due });
      return Promise.resolve({ ok: true, key: due.key });
    });
    await job.run({ args: ['--live'] });
    expect(mocks.rpc.mock.calls.at(-1)).toEqual([
      'sessions.reset',
      { key: 'agent:main:main', expectedSessionId: 'm' },
    ]);
    expect(process.exitCode).toBeUndefined();
    expect(mocks.notice).toHaveBeenCalledWith(due, liveSlack);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/1 reset, .*; failed 0; notice failed 0$/),
    );
  });

  it('closes the DBs when the run throws', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('gateway down'));
    await expect(runSessionRefresh(false)).rejects.toThrow('gateway down');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('fails before opening anything when the settings fail', async () => {
    mocks.settings.mockImplementationOnce(() => {
      throw new Error('no longer reads IDLE_MINUTES');
    });
    await expect(runSessionRefresh(true)).rejects.toThrow('IDLE_MINUTES');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
