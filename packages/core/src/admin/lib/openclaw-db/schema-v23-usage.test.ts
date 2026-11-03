/**
 * Tests for `lastTurnUsage` (session refresh, spec 2.12) on schema-23
 * fixtures and through the schema-24 module: the newest hot assistant
 * turn wins over later non-assistant events, the cold archive is the
 * fallback only when the hot rows hold no usage, zstd rows decode, and a
 * session without usage reads as none.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openAgentDb } from './open-agent-db.js';
import { ms, T10, T11, usage, user } from './openclaw-db.fixtures.js';
import { assistantUsage } from './schema-v23-usage.js';
import { createV23Fixture } from './v23.fixtures.js';

/** An assistant turn with a given context split. */
const turn = (
  tsIso: string,
  input: number,
  cacheRead: number,
  cacheWrite: number,
) =>
  JSON.stringify({
    type: 'message',
    timestamp: tsIso,
    message: {
      role: 'assistant',
      usage: {
        input,
        output: 10,
        cacheRead,
        cacheWrite,
        totalTokens: input + cacheRead + cacheWrite + 10,
      },
    },
  });

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-db-usage-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function lastTurn(dbPath: string, sessionId: string) {
  const agentDb = openAgentDb(dbPath);
  try {
    return agentDb.schema.lastTurnUsage?.(agentDb.db, agentDb.ctx, sessionId);
  } finally {
    agentDb.close();
  }
}

describe.each([23, 24])('lastTurnUsage (schema %i)', (version) => {
  it('returns the newest hot assistant turn, skipping later non-assistant events', () => {
    const fx = createV23Fixture(root, version);
    fx.addHotSession('s', [
      user('hi'),
      turn(T10, 1, 2, 3),
      turn(T11, 5, 100, 7),
      user('later'),
      JSON.stringify({ type: 'custom', data: {} }),
    ]);
    fx.close();
    expect(lastTurn(fx.dbPath, 's')).toEqual({
      input: 5,
      cacheRead: 100,
      cacheWrite: 7,
      tsMs: ms(T11),
    });
  });

  it('decodes zstd hot rows', () => {
    const fx = createV23Fixture(root, version);
    fx.addHotSession('z', [user('a'), turn(T10, 9, 8, 7)], [1]);
    fx.close();
    expect(lastTurn(fx.dbPath, 'z')).toMatchObject({ input: 9, cacheWrite: 7 });
  });

  it('falls back to the cold archive when the hot rows hold no usage', () => {
    const fx = createV23Fixture(root, version);
    fx.addColdSession('c', [user('a'), turn(T10, 1, 0, 900), user('b')]);
    fx.db
      .prepare(
        'INSERT INTO transcript_events (session_id, seq, event_json, created_at, event_utf8_bytes) VALUES (?, ?, ?, ?, ?)',
      )
      .run('c', 3, user('restored'), Date.now(), 10);
    fx.close();
    expect(lastTurn(fx.dbPath, 'c')).toEqual({
      input: 1,
      cacheRead: 0,
      cacheWrite: 900,
      tsMs: ms(T10),
    });
  });

  it('reads a cold-only session from its archive', () => {
    const fx = createV23Fixture(root, version);
    fx.addColdSession('k', [user('a'), usage(T11, 40)]);
    fx.close();
    expect(lastTurn(fx.dbPath, 'k')).toMatchObject({ input: 40 });
  });

  it('returns undefined for a session with no usage, or none at all', () => {
    const fx = createV23Fixture(root, version);
    fx.addHotSession('empty', [user('only a question')]);
    fx.close();
    expect(lastTurn(fx.dbPath, 'empty')).toBeUndefined();
    expect(lastTurn(fx.dbPath, 'missing')).toBeUndefined();
  });
});

describe('assistantUsage', () => {
  it('ignores a non-assistant message that carries usage', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: T10,
      message: { role: 'user', usage: { input: 5, totalTokens: 5 } },
    });
    expect(assistantUsage(line)).toBeUndefined();
  });

  it('counts missing or non-numeric usage fields as zero', () => {
    const line = JSON.stringify({
      type: 'message',
      timestamp: T10,
      message: { role: 'assistant', usage: { totalTokens: 5, input: 'x' } },
    });
    expect(assistantUsage(line)).toEqual({
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      tsMs: ms(T10),
    });
  });
});
