import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openAgentDb, OpenClawSchemaMismatchError } from './open-agent-db.js';

let dir: string;

const makeDb = (file: string, version: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${String(version)}`);
  db.close();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-db-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('openAgentDb', () => {
  it('binds the v23 reader and finds artifacts in the sibling sessions dir', () => {
    const file = path.join(
      dir,
      'agents',
      'main',
      'agent',
      'openclaw-agent.sqlite',
    );
    makeDb(file, 23);
    const agent = openAgentDb(file);
    expect(agent.schema.version).toBe(23);
    expect(agent.ctx.artifactDir).toBe(
      path.join(dir, 'agents', 'main', 'sessions'),
    );
    expect(agent.db.isTransaction).toBe(true);
    agent.close();
  });

  it('uses the DB directory when it is not an agent dir', () => {
    const file = path.join(dir, 'flat', 'db.sqlite');
    makeDb(file, 23);
    const agent = openAgentDb(file);
    expect(agent.ctx.artifactDir).toBe(path.join(dir, 'flat'));
    agent.db.exec('COMMIT');
    agent.close();
  });

  it('refuses an unknown schema version', () => {
    const file = path.join(dir, 'old.sqlite');
    makeDb(file, 7);
    expect(() => openAgentDb(file)).toThrow(OpenClawSchemaMismatchError);
    expect(() => openAgentDb(file)).toThrow(
      /expected user_version 23, found 7/,
    );
  });
});
