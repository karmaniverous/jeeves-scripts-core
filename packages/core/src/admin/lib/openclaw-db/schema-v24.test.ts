import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openAgentDb } from './open-agent-db.js';
import {
  sessionHeader,
  slackChannelEntry,
} from './real-events-v23.fixtures.js';
import { loadV23Meta } from './schema-v23-meta.js';
import { createV23Fixture } from './v23.fixtures.js';

// Builds a real SQLite fixture: slow on a loaded Windows CI runner.
vi.setConfig({ testTimeout: 30_000 });

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-db-v24-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Apply OpenClaw 2026.9.33's schema-24 migration to a schema-23 fixture. */
const migrateToV24 = (dbPath: string) => {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    ALTER TABLE session_nodes ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE session_entry_snapshots (
      session_key TEXT NOT NULL,
      field TEXT NOT NULL,
      value_json TEXT NOT NULL,
      PRIMARY KEY (session_key, field)
    ) STRICT;
    PRAGMA user_version = 24;
  `);
  db.close();
};

describe('schema 24 (#38)', () => {
  it('reads transcripts and channel names through the schema-23 reader', () => {
    const fx = createV23Fixture(root);
    fx.addHotSession('ch', [sessionHeader('ch')], [], {
      key: 'agent:main:slack:channel:c000example2',
      entry: slackChannelEntry('C000EXAMPLE2', 'acme-ops'),
    });
    fx.close();
    migrateToV24(fx.dbPath);

    const agent = openAgentDb(fx.dbPath);
    try {
      expect(agent.schema.version).toBe(24);
      expect(
        agent.schema.listTranscripts(agent.db, agent.ctx).length,
      ).toBeGreaterThan(0);
      expect(loadV23Meta(agent.db).forSession('ch')?.channelName).toBe(
        '#acme-ops',
      );
    } finally {
      agent.close();
    }
  });
});
