/**
 * Tests for Slack read positions in the runner state store (real runner
 * DB in a temp dir): read, absent, invalid, save, unavailable store.
 *
 * @module slack/lib/cursors.test
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeConnection,
  createConnection,
  getRunnerClient,
  runMigrations,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cursorKey,
  loadPollCursors,
  saveCursor,
  SLACK_STATE_NAMESPACE,
  slackTsSchema,
} from './cursors.js';

let dir: string;
let dbPath: string;
let client: RunnerClient;

/** Read a stored position through an independent connection. */
function storedTs(channelId: string): string | null {
  const other = getRunnerClient(dbPath);
  try {
    return other.getState(SLACK_STATE_NAMESPACE, cursorKey(channelId));
  } finally {
    other.close();
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-cursors-'));
  dbPath = path.join(dir, 'runner.sqlite');
  const db = createConnection(dbPath);
  runMigrations(db);
  closeConnection(db);
  client = getRunnerClient(dbPath);
});

afterEach(() => {
  client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadPollCursors', () => {
  it('reads positions from the runner store (slack / lastTs-<channelId>)', () => {
    client.setState('slack', 'lastTs-C1', '1700000000.000100');
    client.setState('slack', 'lastTs-C2', '1700000500.000200');
    expect(loadPollCursors(client, ['C1', 'C2'])).toEqual({
      C1: '1700000000.000100',
      C2: '1700000500.000200',
    });
  });

  it('leaves channels without a position out (read from the beginning)', () => {
    client.setState('slack', 'lastTs-C1', '1700000000.000100');
    expect(loadPollCursors(client, ['C1', 'C9'])).toEqual({
      C1: '1700000000.000100',
    });
    expect(storedTs('C9')).toBeNull();
  });

  it('rejects a stored value that is not a Slack ts', () => {
    client.setState('slack', 'lastTs-C1', 'yesterday');
    expect(() => loadPollCursors(client, ['C1'])).toThrow(
      /Invalid Slack read position "yesterday" in runner state lastTs-C1/,
    );
  });

  it('fails on an unavailable store even with no channels', () => {
    client.close();
    expect(() => loadPollCursors(client, [])).toThrow(
      /Slack read positions unavailable/,
    );
    client = getRunnerClient(dbPath);
  });
});

describe('saveCursor', () => {
  it('writes the position under slack / lastTs-<channelId>', () => {
    saveCursor(client, 'C1', '1700000000.000100');
    expect(storedTs('C1')).toBe('1700000000.000100');
  });
});

describe('slackTsSchema', () => {
  it.each(['1700000000.000100', '1.2'])('accepts %s', (ts) => {
    expect(slackTsSchema.safeParse(ts).success).toBe(true);
  });
  it.each(['', '0', 'abc', '1700000000'])('rejects %j', (ts) => {
    expect(slackTsSchema.safeParse(ts).success).toBe(false);
  });
});
