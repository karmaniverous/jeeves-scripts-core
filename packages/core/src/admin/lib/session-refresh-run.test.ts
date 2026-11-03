/**
 * Tests for the session-refresh run flow (dry run and the failures that
 * fail the run) over fake collaborators: a dry run makes no describe or
 * reset call and logs every would-reset; every in-scope skip is logged
 * with its reason and out-of-scope rows are counted per class; the summary
 * counts; a failed list, an unreadable agent DB or a row with no agent
 * throws, with no "nothing to do". The live flow is in
 * session-refresh-run.live.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { minutesAgo, row, turn } from './session-refresh.fixtures.js';
import { sessionRefresh } from './session-refresh-run.js';
import {
  BIG,
  depsFor,
  dueA,
  dueB,
  useConsoleCapture,
} from './session-refresh-run.test-helper.js';

const out = useConsoleCapture();

describe('sessionRefresh (dry run)', () => {
  it('logs every would-reset and calls nothing that writes', async () => {
    const { deps, gateway } = depsFor([dueA, dueB], {
      a: BIG,
      b: turn({ input: 150_000 }, minutesAgo(300)),
    });
    const s = await sessionRefresh(deps);
    expect(gateway.describe).not.toHaveBeenCalled();
    expect(gateway.reset).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
    expect(out.logs).toContain(
      '[session-refresh] dry run: threshold 150000, idle 60 min, 1 excluded key(s)',
    );
    expect(out.logs).toContain(
      '[session-refresh] would reset agent:main:slack:channel:ca (context 200000, idle 90 min, session a)',
    );
    expect(out.logs).toContain(
      '[session-refresh] would reset agent:ops:slack:channel:cb (context 150000, idle 300 min, session b)',
    );
    expect(s).toMatchObject({
      listed: 2,
      inScope: 2,
      due: 2,
      reset: 0,
      failed: 0,
    });
    expect(deps.usage).toHaveBeenCalledWith('ops', 'b');
  });

  it('logs each in-scope skip with its reason, counts out-of-scope classes and summarises', async () => {
    const rows = [
      row({ key: 'agent:main:main', sessionId: 'm' }),
      row({ key: 'agent:main:subagent:1', sessionId: 's1' }),
      row({ key: 'agent:main:subagent:2', sessionId: 's2' }),
      row({ key: 'agent:main:cron:j', sessionId: 'c' }),
      row({
        key: 'agent:main:slack:channel:busy',
        sessionId: 'x',
        hasActiveRun: true,
      }),
      row({
        key: 'agent:main:slack:channel:recent',
        sessionId: 'r',
        lastInteractionAt: minutesAgo(5),
      }),
      row({ key: 'agent:main:slack:channel:empty', sessionId: 'e' }),
      row({
        key: 'agent:main:slack:channel:small',
        sessionId: 'sm',
        hasActiveRun: undefined,
        activeRunIds: undefined,
      }),
    ];
    const { deps } = depsFor(rows, { r: BIG, sm: turn({ cacheRead: 10 }) });
    const s = await sessionRefresh(deps);
    expect(out.logs).toEqual(
      expect.arrayContaining([
        '[session-refresh] 8 sessions',
        '[session-refresh] skip agent:main:main: excluded',
        '[session-refresh] skip agent:main:slack:channel:busy: busy (active run)',
        '[session-refresh] skip agent:main:slack:channel:recent: recently active (5 min)',
        '[session-refresh] skip agent:main:slack:channel:empty: no usage',
        '[session-refresh] skip agent:main:slack:channel:small: small (10), ownership unknown',
        '[session-refresh] out of scope: subagent 2, cron 1',
        'session-refresh: 8 listed, 4 in scope, 0 due, 0 reset, skipped: excluded 1, busy 1, recently active 1, no usage 1, small 1; failed 0; notice failed 0',
      ]),
    );
    expect(deps.usage).not.toHaveBeenCalledWith('main', 'x');
    expect(s.failed).toBe(0);
  });

  it('logs 0 sessions for an empty list', async () => {
    const { deps } = depsFor([]);
    await sessionRefresh(deps);
    expect(out.logs).toContain('[session-refresh] 0 sessions');
    expect(out.logs.at(-1)).toContain('skipped: none');
    expect(out.logs.some((l) => l.includes('out of scope'))).toBe(false);
  });
});

describe('sessionRefresh failures that fail the run', () => {
  it('throws on a failed list and never says nothing to do', async () => {
    const { deps } = depsFor([]);
    deps.gateway.list = () => Promise.reject(new Error('gateway down'));
    await expect(sessionRefresh(deps)).rejects.toThrow('gateway down');
    expect([...out.logs, ...out.errors].join('\n')).not.toMatch(
      /nothing to do/i,
    );
  });

  it('throws when an agent DB cannot be read', async () => {
    const { deps } = depsFor(
      [dueA],
      {},
      {
        usage: () => {
          throw new Error('OpenClaw agent DB for agent main not found');
        },
      },
    );
    await expect(sessionRefresh(deps)).rejects.toThrow(
      'agent DB for agent main not found',
    );
  });

  it('throws for an in-scope row with no agent', async () => {
    const { deps } = depsFor([row({ key: 'odd-key', agentId: undefined })]);
    await expect(sessionRefresh(deps)).rejects.toThrow(
      'no agent for session odd-key',
    );
  });
});
