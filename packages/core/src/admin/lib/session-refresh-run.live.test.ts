/**
 * Tests for the live session-refresh run flow over fake collaborators: it
 * re-checks, resets with `expectedSessionId` oldest first and posts the
 * notice; the re-check catches a session that became busy, recently active
 * or changed, or whose spawned child runs; the active list is read fresh
 * per due session after its describe; a `session-changed` rejection is a
 * skip; another failure is
 * counted and the next session still tried; a failed notice is counted but
 * never fails the run.
 */

import { describe, expect, it } from 'vitest';

import { minutesAgo, row } from './session-refresh.fixtures.js';
import { sessionRefresh, summaryLine } from './session-refresh-run.js';
import {
  BIG,
  depsFor,
  dueA,
  dueB,
  useConsoleCapture,
} from './session-refresh-run.test-helper.js';

const out = useConsoleCapture();

describe('sessionRefresh (live)', () => {
  it('re-checks and resets oldest activity first with expectedSessionId, then posts the notice', async () => {
    const { deps, gateway } = depsFor(
      [dueA, dueB],
      { a: BIG, b: BIG },
      { live: true },
    );
    const s = await sessionRefresh(deps);
    expect(gateway.reset.mock.calls).toEqual([
      ['agent:ops:slack:channel:cb', 'b'],
      ['agent:main:slack:channel:ca', 'a'],
    ]);
    expect(gateway.describe).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenCalledWith(dueA);
    expect(out.logs).toContain(
      '[session-refresh] reset agent:main:slack:channel:ca (context 200000, idle 90 min, old session a)',
    );
    expect(out.logs).toContain(
      '[session-refresh] notice posted for agent:main:slack:channel:ca',
    );
    expect(s).toMatchObject({ due: 2, reset: 2, failed: 0 });
  });

  it('skips a session that became busy or changed at the re-check', async () => {
    const { deps, gateway } = depsFor(
      [dueA, dueB],
      { a: BIG, b: BIG },
      { live: true },
    );
    gateway.describe
      .mockResolvedValueOnce({ ...dueB, hasActiveRun: true })
      .mockResolvedValueOnce({ ...dueA, sessionId: 'new' });
    const s = await sessionRefresh(deps);
    expect(gateway.reset).not.toHaveBeenCalled();
    expect(out.logs).toContain(
      '[session-refresh] skip agent:ops:slack:channel:cb: busy (active run)',
    );
    expect(out.logs).toContain(
      '[session-refresh] skip agent:main:slack:channel:ca: changed',
    );
    expect(s.skipped.get('changed')).toBe(1);
  });

  it('decides the re-check on idle time when describe omits the activity fields', async () => {
    const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
    gateway.describe.mockResolvedValueOnce({
      key: dueA.key,
      sessionId: 'a',
      lastInteractionAt: minutesAgo(2),
    });
    await sessionRefresh(deps);
    expect(gateway.reset).not.toHaveBeenCalled();
    expect(out.logs).toContain(
      '[session-refresh] skip agent:main:slack:channel:ca: recently active (2 min), ownership unknown',
    );
  });

  it('skips a session in the active list when describe omits the busy fields, never resetting it', async () => {
    const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
    gateway.describe.mockResolvedValueOnce({
      key: dueA.key,
      sessionId: 'a',
      lastInteractionAt: minutesAgo(90),
    });
    gateway.active.mockResolvedValueOnce([dueA]);
    const s = await sessionRefresh(deps);
    expect(gateway.reset).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
    expect(out.logs).toContain(
      '[session-refresh] skip agent:main:slack:channel:ca: busy (active run, list)',
    );
    expect(s).toMatchObject({ reset: 0, failed: 0 });
    expect(s.skipped.get('busy')).toBe(1);
  });

  it('resets when the active list holds other keys but not this one', async () => {
    const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
    gateway.describe.mockResolvedValueOnce({
      key: dueA.key,
      sessionId: 'a',
      lastInteractionAt: minutesAgo(90),
    });
    gateway.active.mockResolvedValueOnce([dueB]);
    const s = await sessionRefresh(deps);
    expect(gateway.active).toHaveBeenCalledTimes(1);
    expect(gateway.reset.mock.calls).toEqual([[dueA.key, 'a']]);
    expect(out.logs).toContain(
      '[session-refresh] reset agent:main:slack:channel:ca (context 200000, idle 90 min, old session a)',
    );
    expect(s).toMatchObject({ reset: 1, failed: 0 });
  });

  it.each([
    ['spawnedBy', { spawnedBy: dueA.key }],
    ['parentSessionKey', { parentSessionKey: dueA.key }],
  ])(
    'skips a session whose spawned child is in the active list (%s)',
    async (_field, lineage) => {
      const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
      gateway.active.mockResolvedValueOnce([
        row({ key: 'agent:main:subagent:x', sessionId: 'x', ...lineage }),
      ]);
      const s = await sessionRefresh(deps);
      expect(gateway.reset).not.toHaveBeenCalled();
      expect(out.logs).toContain(
        '[session-refresh] skip agent:main:slack:channel:ca: busy (child run)',
      );
      expect(s.skipped.get('busy')).toBe(1);
    },
  );

  it('reads the active list afresh for each due session, after its describe', async () => {
    const { deps, gateway } = depsFor(
      [dueA, dueB],
      { a: BIG, b: BIG },
      { live: true },
    );
    const calls: string[] = [];
    gateway.describe.mockImplementation((key: string) => {
      calls.push(`describe ${key}`);
      return Promise.resolve(key === dueA.key ? dueA : dueB);
    });
    // B is reset first (oldest); A's child starts running only after that.
    gateway.active
      .mockImplementationOnce(() => {
        calls.push('active');
        return Promise.resolve([]);
      })
      .mockImplementationOnce(() => {
        calls.push('active');
        return Promise.resolve([
          row({ key: 'agent:main:subagent:y', spawnedBy: dueA.key }),
        ]);
      });
    gateway.reset.mockImplementation((key: string) => {
      calls.push(`reset ${key}`);
      return Promise.resolve('reset');
    });
    const s = await sessionRefresh(deps);
    expect(calls).toEqual([
      `describe ${dueB.key}`,
      'active',
      `reset ${dueB.key}`,
      `describe ${dueA.key}`,
      'active',
    ]);
    expect(s).toMatchObject({ reset: 1, failed: 0 });
    expect(out.logs).toContain(
      '[session-refresh] skip agent:main:slack:channel:ca: busy (child run)',
    );
  });

  it('counts a failed active list as a failure and does not reset', async () => {
    const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
    gateway.active.mockRejectedValueOnce(
      new Error('gateway sessions.list returned an unexpected shape'),
    );
    const s = await sessionRefresh(deps);
    expect(gateway.reset).not.toHaveBeenCalled();
    expect(out.errors).toContain(
      '[session-refresh] failed agent:main:slack:channel:ca: gateway sessions.list returned an unexpected shape',
    );
    expect(s).toMatchObject({ reset: 0, failed: 1 });
  });

  it('treats a session-changed rejection as a skip', async () => {
    const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
    gateway.reset.mockResolvedValueOnce('changed');
    const s = await sessionRefresh(deps);
    expect(s).toMatchObject({ reset: 0, failed: 0 });
    expect(s.skipped.get('changed')).toBe(1);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('logs and counts another failure, and tries the next session', async () => {
    const { deps, gateway } = depsFor(
      [dueA, dueB],
      { a: BIG, b: BIG },
      { live: true },
    );
    gateway.reset.mockRejectedValueOnce(
      new Error('missing scope: operator.admin'),
    );
    const s = await sessionRefresh(deps);
    expect(out.errors).toContain(
      '[session-refresh] failed agent:ops:slack:channel:cb: missing scope: operator.admin',
    );
    expect(s).toMatchObject({ reset: 1, failed: 1 });
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(dueA);
    expect(out.logs.at(-1)).toMatch(/; failed 1; notice failed 0$/);
  });

  it('counts a failed describe as a failure', async () => {
    const { deps, gateway } = depsFor([dueA], { a: BIG }, { live: true });
    gateway.describe.mockRejectedValueOnce(new Error('timeout'));
    await expect(sessionRefresh(deps)).resolves.toMatchObject({
      failed: 1,
      reset: 0,
    });
  });

  it('counts a failed notice without failing the run or undoing the reset', async () => {
    const { deps } = depsFor(
      [dueA],
      { a: BIG },
      {
        live: true,
        notify: () => Promise.reject(new Error('channel_not_found')),
      },
    );
    const s = await sessionRefresh(deps);
    expect(s).toMatchObject({ reset: 1, failed: 0, noticeFailed: 1 });
    expect(out.errors).toContain(
      '[session-refresh] notice failed agent:main:slack:channel:ca: channel_not_found',
    );
    expect(summaryLine(s)).toMatch(/notice failed 1$/);
  });

  it('logs no notice line for a non-Slack session', async () => {
    const { deps } = depsFor(
      [dueA],
      { a: BIG },
      { live: true, notify: () => Promise.resolve('none') },
    );
    await sessionRefresh(deps);
    expect(out.logs.some((l) => l.includes('notice posted'))).toBe(false);
  });
});
