import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import type { CalendarEvent } from './lib/calendar-api.js';
import { eventHash, sanitize, writeEvent } from './lib/calendar-store.js';
import {
  type CalendarPollDeps,
  calendarPollDeps,
  FORWARD_DAYS,
  INITIAL_LOOKBACK_DAYS,
  pollCalendars,
} from './poll.js';

const NOW = new Date('2026-05-01T00:00:00.000Z');
let dir: string;
let runner: ReturnType<typeof fakeRunnerClient>;
let windows: string[][];

const event = (id: string, summary = 's'): CalendarEvent => ({
  id,
  summary,
  start: { dateTime: '2026-05-02T10:00:00Z' },
  attendees: [{ email: 'jane@example.com', responseStatus: 'accepted' }],
});

const acct = (email: string) => ({
  email,
  type: 'gmail' as const,
  emailPolling: false,
});

const deps = (over: Partial<CalendarPollDeps> = {}): CalendarPollDeps => ({
  configured: () => [acct('jane@example.com')],
  resolve: (configured) => ({
    accounts: configured.map((a) => ({ email: a.email })),
    problems: [],
  }),
  accessToken: () => Promise.resolve('tok'),
  listCalendars: () =>
    Promise.resolve([
      { id: 'primary', summary: 'Work: Main' },
      { id: 'fb', accessRole: 'freeBusyReader' },
      { id: 'empty' },
      { id: 'broken', summary: 'Broken' },
    ]),
  getAllEvents: (_t, calendarId, timeMin, timeMax) => {
    windows.push([calendarId, timeMin, timeMax]);
    if (calendarId === 'broken') return Promise.reject(new Error('403'));
    return Promise.resolve(
      calendarId === 'primary' ? [event('e1'), event('e2')] : [],
    );
  },
  calendarBase: (email) => path.join(dir, email),
  runner: () => runner.client,
  now: () => NOW,
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-'));
  runner = fakeRunnerClient();
  windows = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pollCalendars', () => {
  it('skips without calendar accounts', async () => {
    await pollCalendars(deps({ configured: () => [] }));
    expect(console.log).toHaveBeenCalledWith(
      '[skip] No calendar accounts configured',
    );
    expect(runner.closed()).toBe(false);
  });

  it('writes events of readable calendars, logs a failing calendar and records the sync', async () => {
    await pollCalendars(deps());
    const file = path.join(dir, 'jane@example.com', 'Work_ Main', 'e1.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(stored).toMatchObject({
      _calendarId: 'primary',
      _calendarSummary: 'Work: Main',
      id: 'e1',
    });
    expect(windows.map((w) => w[0])).toEqual(['primary', 'empty', 'broken']);
    const day = 86_400_000;
    expect(windows[0]?.[1]).toBe(
      new Date(NOW.getTime() - INITIAL_LOOKBACK_DAYS * day).toISOString(),
    );
    expect(windows[0]?.[2]).toBe(
      new Date(NOW.getTime() + FORWARD_DAYS * day).toISOString(),
    );
    expect(console.error).toHaveBeenCalledWith('  Error fetching Broken: 403');
    expect(console.log).toHaveBeenCalledWith(
      '  Total: 2 events, 2 new/updated',
    );
    expect(
      runner.client.getState('calendar', 'lastSync-jane@example.com'),
    ).toBe(NOW.toISOString());
    expect(runner.closed()).toBe(true);
  });

  it('starts a day before the last sync and rewrites nothing unchanged', async () => {
    await pollCalendars(deps());
    windows = [];
    runner.client.setState(
      'calendar',
      'lastSync-jane@example.com',
      '2026-04-20T00:00:00.000Z',
    );
    await pollCalendars(deps());
    expect(windows[0]?.[1]).toBe('2026-04-19T00:00:00.000Z');
    expect(console.log).toHaveBeenCalledWith(
      '  Total: 2 events, 0 new/updated',
    );
  });

  it('polls the rest when one account fails, then fails for credential problems', async () => {
    const d = deps({
      configured: () => [acct('a@x.com'), acct('b@x.com'), acct('c@x.com')],
      resolve: () => ({
        accounts: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
        problems: ['c@x.com: no key'],
      }),
      accessToken: (a) =>
        a.email === 'a@x.com'
          ? Promise.reject(new Error('expired'))
          : Promise.resolve('t'),
    });
    await expect(pollCalendars(d)).rejects.toThrow(
      'calendar/poll: 1 calendar account(s) have no usable gog credentials: c@x.com: no key',
    );
    expect(console.error).toHaveBeenCalledWith('[credentials] c@x.com: no key');
    expect(console.error).toHaveBeenCalledWith(
      'Error polling a@x.com: expired',
    );
    expect(runner.client.getState('calendar', 'lastSync-b@x.com')).toBe(
      NOW.toISOString(),
    );
  });
});

describe('calendar-store', () => {
  it('sanitizes names and hashes only significant fields', () => {
    expect(sanitize('')).toBe('unknown');
    expect(sanitize('a/b:c   d')).toBe('a_b_c d');
    expect(eventHash(event('x'))).toBe(
      eventHash({ ...event('x'), etag: 'changed' }),
    );
    expect(eventHash(event('x'))).not.toBe(eventHash(event('x', 'other')));
  });

  it('overwrites a corrupt stored event', () => {
    const calDir = path.join(dir, 'primary');
    fs.mkdirSync(calDir, { recursive: true });
    fs.writeFileSync(path.join(calDir, 'e1.json'), '{bad');
    expect(
      writeEvent(dir, 'primary', undefined, event('e1'), NOW.toISOString()),
    ).toBe(true);
    expect(
      writeEvent(dir, 'primary', undefined, event('e1'), NOW.toISOString()),
    ).toBe(false);
  });
});

describe('calendarPollDeps', () => {
  it('reads accounts and the archive base from config', () => {
    const live = calendarPollDeps();
    expect(live.configured()).toEqual([]);
    expect(live.calendarBase('jane@example.com')).toContain(
      path.join('calendar', 'jane@example.com'),
    );
    expect(live.resolve([]).accounts).toEqual([]);
  });
});
