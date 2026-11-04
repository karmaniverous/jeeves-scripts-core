/**
 * Tests for session refresh's pure rules (spec 2.12, behaviour 3-6):
 * every scope class, exclusion, busy by each signal, idle on each
 * timestamp and at the boundary, and the trigger at, below and above the
 * threshold with the context in each usage field alone.
 */

import { describe, expect, it } from 'vitest';

import { minutesAgo, NOW, row, turn } from './session-refresh.fixtures.js';
import {
  agentOf,
  busyOf,
  childRunParents,
  decide,
  lastActivityOf,
  parseKey,
  type RefreshSettings,
  scopeOf,
} from './session-refresh-select.js';

const settings: RefreshSettings = {
  contextThreshold: 1000,
  idleMinutes: 60,
  excludedKeys: new Set(['agent:main:slack:channel:c0000000077']),
};

describe('scopeOf', () => {
  it.each([
    ['a subagent key', row({ key: 'agent:main:subagent:abc' }), 'subagent'],
    ['a cron key', row({ key: 'agent:ops:cron:job-1' }), 'cron'],
    ['spawnedBy', row({ spawnedBy: 'agent:main:main' }), 'spawned'],
    ['parentSessionKey', row({ parentSessionKey: 'agent:main:x' }), 'spawned'],
    ['spawnDepth > 0', row({ spawnDepth: 1 }), 'spawned'],
    ['the raw unknown sentinel', row({ key: 'unknown' }), 'unknown'],
    [
      'an agent unknown sentinel',
      row({ key: 'agent:main:unknown' }),
      'unknown',
    ],
    ['raw global', row({ key: 'global' }), 'global'],
    ['an archived row', row({ archived: true }), 'archived'],
    [
      'an excluded key',
      row({ key: 'agent:main:slack:channel:c0000000077' }),
      'excluded',
    ],
    ['agent:main:main', row({ key: 'agent:main:main' }), 'in'],
    ["another agent's main", row({ key: 'agent:ops:main' }), 'in'],
    ['a Slack channel', row(), 'in'],
    ['a Slack DM', row({ key: 'agent:main:slack:direct:u0000000001' }), 'in'],
    ['a non-Slack DM', row({ key: 'agent:main:telegram:direct:42' }), 'in'],
    [
      'spawnDepth 0 and null lineage',
      row({ spawnDepth: 0, spawnedBy: null }),
      'in',
    ],
  ])('%s', (_name, r, scope) => {
    expect(scopeOf(r, settings)).toBe(scope);
  });
});

describe('busyOf', () => {
  it.each([
    ['hasActiveRun', row({ hasActiveRun: true }), 'busy (active run)', false],
    [
      'non-empty activeRunIds',
      row({ hasActiveRun: false, activeRunIds: ['r1'] }),
      'busy (active run)',
      false,
    ],
    [
      'active runs with hasActiveRun absent',
      row({ hasActiveRun: undefined, activeRunIds: ['r1'] }),
      'busy (active run)',
      false,
    ],
    [
      'a non-local placement',
      row({ placement: { state: 'draining' } }),
      'busy (placement draining)',
      false,
    ],
    [
      'activeRunIds [] (proves idle)',
      row({ hasActiveRun: undefined, activeRunIds: [] }),
      undefined,
      false,
    ],
    ['idle', row(), undefined, false],
    [
      'neither activity field',
      row({ hasActiveRun: undefined, activeRunIds: undefined }),
      undefined,
      true,
    ],
    [
      'null activity fields',
      row({ hasActiveRun: null, activeRunIds: null }),
      undefined,
      true,
    ],
    ['no or null placement', row({ placement: null }), undefined, false],
  ])('%s', (_name, r, busy, ownershipUnknown) => {
    expect(busyOf(r)).toEqual(
      busy ? { busy, ownershipUnknown } : { ownershipUnknown },
    );
  });

  it('is busy (child run) when a spawned child runs, own run first', () => {
    const parents = new Set([row().key]);
    expect(busyOf(row(), parents)).toEqual({
      busy: 'busy (child run)',
      ownershipUnknown: false,
    });
    expect(busyOf(row({ hasActiveRun: true }), parents).busy).toBe(
      'busy (active run)',
    );
    expect(busyOf(row({ key: 'agent:main:main' }), parents).busy).toBe(
      undefined,
    );
  });
});

describe('childRunParents', () => {
  const child = (over: Parameters<typeof row>[0]) =>
    row({ key: 'agent:main:subagent:c', ...over });

  it('names the parents of rows with an active run, by either lineage field', () => {
    const rows = [
      child({ spawnedBy: 'agent:main:main', hasActiveRun: true }),
      child({ parentSessionKey: 'p2', activeRunIds: ['r'] }),
      child({ spawnedBy: 'idle-parent' }),
      child({ spawnedBy: 'p3', parentSessionKey: 'p4', hasActiveRun: true }),
      row({ hasActiveRun: true }),
    ];
    expect(childRunParents(rows)).toEqual(
      new Set(['agent:main:main', 'p2', 'p3', 'p4']),
    );
  });

  it('takes every row as running when told to (the active list)', () => {
    expect(
      childRunParents([child({ spawnedBy: 'idle-parent' })], () => true),
    ).toEqual(new Set(['idle-parent']));
  });
});

describe('lastActivityOf', () => {
  it.each([
    [
      'lastActivityAt',
      { lastActivityAt: minutesAgo(10) },
      undefined,
      minutesAgo(10),
    ],
    [
      'lastInteractionAt',
      { lastInteractionAt: minutesAgo(10) },
      undefined,
      minutesAgo(10),
    ],
    ['the last turn', {}, turn({}, minutesAgo(10)), minutesAgo(10)],
  ])('takes %s when it is the latest', (_name, times, usage, expected) => {
    const r = row({
      lastActivityAt: minutesAgo(300),
      lastInteractionAt: minutesAgo(200),
      ...times,
    });
    expect(lastActivityOf(r, usage ?? turn({}, minutesAgo(400)))).toBe(
      expected,
    );
  });

  it('is undefined with no timestamp at all', () => {
    expect(
      lastActivityOf(row({ lastInteractionAt: undefined }), undefined),
    ).toBeUndefined();
  });

  it('ignores a non-finite turn time', () => {
    const at = minutesAgo(90);
    expect(
      lastActivityOf(row({ lastInteractionAt: at }), turn({}, Number.NaN)),
    ).toBe(at);
  });
});

describe('decide', () => {
  const due = (r = row(), usage = turn({ cacheRead: 2000 })) =>
    decide(r, usage, settings, NOW);

  it('skips a busy session before reading anything else', () => {
    expect(
      decide(row({ hasActiveRun: true }), undefined, settings, NOW),
    ).toMatchObject({
      kind: 'skip',
      reason: 'busy',
      detail: 'busy (active run)',
    });
  });

  it('skips a recently active session with its idle minutes', () => {
    expect(due(row({ lastInteractionAt: minutesAgo(59.5) }))).toMatchObject({
      kind: 'skip',
      reason: 'recently active',
      detail: 'recently active (59 min)',
    });
  });

  it('counts a session idle for exactly idleMinutes as idle', () => {
    expect(
      due(
        row({ lastInteractionAt: minutesAgo(60) }),
        turn({ cacheRead: 2000 }, minutesAgo(61)),
      ),
    ).toMatchObject({ kind: 'due', idleMin: 60 });
  });

  it('lets the last turn time make a session recently active', () => {
    expect(due(row(), turn({ cacheRead: 2000 }, minutesAgo(5)))).toMatchObject({
      reason: 'recently active',
    });
  });

  it('skips a session with no activity time', () => {
    expect(
      decide(row({ lastInteractionAt: undefined }), undefined, settings, NOW),
    ).toMatchObject({ reason: 'no activity time' });
  });

  it('skips a session with no usage', () => {
    expect(decide(row(), undefined, settings, NOW)).toMatchObject({
      reason: 'no usage',
      detail: 'no usage',
    });
  });

  it.each([
    ['below', 999, { kind: 'skip', reason: 'small', detail: 'small (999)' }],
    ['at', 1000, { kind: 'due', total: 1000 }],
    ['above', 1001, { kind: 'due', total: 1001 }],
  ])('a context %s the threshold decides %j', (_name, total, expected) => {
    expect(due(row(), turn({ input: total }))).toMatchObject(expected);
  });

  it.each(['input', 'cacheRead', 'cacheWrite'] as const)(
    'triggers on context in %s alone',
    (field) => {
      expect(due(row(), turn({ [field]: 1500 }))).toMatchObject({
        kind: 'due',
        total: 1500,
      });
    },
  );

  it('makes the cache-expired case (large cacheWrite, small cacheRead) due', () => {
    expect(
      due(row(), turn({ input: 3, cacheRead: 100, cacheWrite: 950 })),
    ).toMatchObject({
      kind: 'due',
      total: 1053,
      lastActivityMs: minutesAgo(120),
    });
  });

  it('carries ownership unknown through a skip and a due decision', () => {
    const unknown = row({ hasActiveRun: undefined, activeRunIds: undefined });
    expect(due(unknown)).toMatchObject({ kind: 'due', ownershipUnknown: true });
    expect(due({ ...unknown, lastInteractionAt: minutesAgo(1) })).toMatchObject(
      { kind: 'skip', ownershipUnknown: true },
    );
    expect(decide(unknown, undefined, settings, NOW)).toMatchObject({
      kind: 'skip',
      reason: 'no usage',
      ownershipUnknown: true,
    });
  });
});

describe('parseKey / agentOf', () => {
  it('splits agent keys and takes the agent from the row first', () => {
    expect(parseKey('agent:ops:slack:channel:c1')).toEqual({
      agentId: 'ops',
      rest: 'slack:channel:c1',
    });
    expect(parseKey('global')).toBeUndefined();
    expect(agentOf(row({ agentId: 'ops' }))).toBe('ops');
    expect(agentOf(row({ agentId: undefined, key: 'agent:x:main' }))).toBe('x');
    expect(agentOf(row({ agentId: null, key: 'odd' }))).toBeUndefined();
  });
});
