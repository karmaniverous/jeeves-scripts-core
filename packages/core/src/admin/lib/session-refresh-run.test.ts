import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  sessionRefresh,
  type SessionRefreshDeps,
  sessionRefreshSettings,
} from './session-refresh-run.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const HOUR = 3_600_000;

let dir: string;
let calls: { tool: string; args: Record<string, unknown> }[];

const transcript = (cacheRead: number, ageMs: number): string =>
  [
    JSON.stringify({ type: 'session', id: 's' }),
    JSON.stringify({
      type: 'message',
      timestamp: new Date(NOW - ageMs).toISOString(),
      message: { role: 'assistant', usage: { cacheRead } },
    }),
  ].join('\n');

const writeSession = (id: string, cacheRead: number, ageMs: number): void => {
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), transcript(cacheRead, ageMs));
};

const writeSessions = (sessions: Record<string, unknown>): void => {
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(sessions));
};

const readSessions = (): Record<string, Record<string, unknown>> =>
  JSON.parse(
    fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'),
  ) as Record<string, Record<string, unknown>>;

const deps = (over: Partial<SessionRefreshDeps> = {}): SessionRefreshDeps => {
  let n = 0;
  return {
    sessionsDir: dir,
    invoke: (tool, args) => {
      calls.push({ tool, args });
      return Promise.resolve({});
    },
    now: () => NOW,
    uuid: () => `new-${String(++n)}`,
    settings: sessionRefreshSettings({}),
    ...over,
  };
};

const slack = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  channel: 'slack',
  spawnDepth: 0,
  ...extra,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-refresh-'));
  calls = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('sessionRefreshSettings', () => {
  it('reads thresholds and trimmed exclusions, defaulting bad numbers', () => {
    const s = sessionRefreshSettings({
      CACHE_READ_THRESHOLD: '2000',
      IDLE_MINUTES: 'soon',
      EXCLUDED_SESSION_KEYS: ' a, ,b ',
    });
    expect(s.cacheReadThreshold).toBe(2000);
    expect(s.idleMinutes).toBe(60);
    expect([...s.excludedKeys]).toEqual(['a', 'b']);
    expect(sessionRefreshSettings({}).cacheReadThreshold).toBe(150_000);
  });
});

describe('sessionRefresh', () => {
  it('does nothing without sessions.json, or when it is not JSON', async () => {
    await expect(sessionRefresh(deps())).resolves.toBe(0);
    fs.writeFileSync(path.join(dir, 'sessions.json'), '{bad');
    await expect(sessionRefresh(deps())).resolves.toBe(0);
    expect(calls).toEqual([]);
  });

  it('rotates a due session, writes sessions.json, then notifies', async () => {
    writeSession('old', 200_000, 2 * HOUR);
    writeSessions({
      'slack:channel:C1': slack('old', {
        sessionFile: path.join(dir, 'old.jsonl'),
        origin: { nativeChannelId: 'C1' },
      }),
    });
    await expect(sessionRefresh(deps())).resolves.toBe(1);

    expect(fs.existsSync(path.join(dir, 'old.jsonl'))).toBe(false);
    expect(
      fs.existsSync(path.join(dir, `old.jsonl.reset.${String(NOW)}`)),
    ).toBe(true);
    expect(readSessions()['slack:channel:C1']).toMatchObject({
      sessionId: 'new-1',
      updatedAt: NOW,
      sessionFile: path.join(dir, 'new-1.jsonl'),
    });
    expect(fs.existsSync(path.join(dir, 'sessions.json.tmp'))).toBe(false);
    expect(calls.map((c) => c.tool)).toEqual(['message', 'sessions_send']);
    expect(calls[0]?.args).toMatchObject({ target: 'C1', channel: 'slack' });
    expect(String(calls[0]?.args.message)).toContain('>150K tokens');
    expect(calls[1]?.args).toMatchObject({ sessionKey: 'slack:channel:C1' });
  });

  it('skips excluded, non-Slack, sub-agent, missing, fresh, small and timestamp-less sessions', async () => {
    writeSession('excluded', 200_000, 2 * HOUR);
    writeSession('fresh', 200_000, HOUR / 2);
    writeSession('small', 1_000, 2 * HOUR);
    fs.writeFileSync(
      path.join(dir, 'nots.jsonl'),
      '{"type":"session"}\nnot json',
    );
    writeSessions({
      excluded: slack('excluded'),
      web: { sessionId: 'excluded', channel: 'web' },
      sub: slack('excluded', { spawnDepth: 1 }),
      missing: slack('nope'),
      fresh: slack('fresh'),
      small: slack('small'),
      nots: slack('nots'),
    });
    const settings = {
      ...sessionRefreshSettings({}),
      excludedKeys: new Set(['excluded']),
    };
    await expect(sessionRefresh(deps({ settings }))).resolves.toBe(0);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.reset.'))).toEqual(
      [],
    );
    expect(calls).toEqual([]);
  });

  it('keeps going when one rename fails and logs failed notifications', async () => {
    writeSession('a', 200_000, 2 * HOUR);
    writeSession('b', 200_000, 2 * HOUR);
    // A directory where the reset file would go makes this rename fail.
    fs.mkdirSync(path.join(dir, `a.jsonl.reset.${String(NOW)}`));
    fs.writeFileSync(path.join(dir, `a.jsonl.reset.${String(NOW)}`, 'x'), '');
    writeSessions({ a: slack('a'), b: slack('b') });
    const invoke = vi.fn(() => Promise.reject(new Error('gateway down')));
    await expect(sessionRefresh(deps({ invoke }))).resolves.toBe(1);
    expect(readSessions().a?.sessionId).toBe('a');
    expect(readSessions().b?.sessionId).toBe('new-1');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to send Slack notification: gateway down',
      ),
    );
  });

  it('rolls every rename back and fails when sessions.json cannot be written', async () => {
    writeSession('a', 200_000, 2 * HOUR);
    writeSession('b', 200_000, 2 * HOUR);
    writeSessions({ a: slack('a'), b: slack('b') });
    const before = fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8');
    // A directory at the temp path makes the atomic write fail.
    fs.mkdirSync(path.join(dir, 'sessions.json.tmp'));
    await expect(sessionRefresh(deps())).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'a.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'b.jsonl'))).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.reset.'))).toEqual(
      [],
    );
    expect(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')).toBe(
      before,
    );
    expect(calls).toEqual([]);
  });

  it('reports a rollback that itself fails', async () => {
    writeSession('a', 200_000, 2 * HOUR);
    writeSessions({ a: slack('a') });
    fs.mkdirSync(path.join(dir, 'sessions.json.tmp'));
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).includes('.reset.')) throw new Error('locked');
      rename(from, to);
    });
    await expect(sessionRefresh(deps())).rejects.toThrow();
    expect(console.error).toHaveBeenCalledWith(
      '  Failed to roll back transcript rename: locked',
    );
  });
});
