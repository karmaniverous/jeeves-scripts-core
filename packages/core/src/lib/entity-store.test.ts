/**
 * Tests for entity-store — upsert, backfill, delete, and writeUnmatched.
 *
 * Uses a temp directory with afterEach cleanup.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EntityFile } from './entity-store.js';
import {
  backfillEntity,
  deleteEntity,
  upsertEntity,
  writeUnmatched,
} from './entity-store.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-store-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readEntity(filePath: string): EntityFile {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as EntityFile;
}

describe('upsertEntity', () => {
  it('creates new entity file with correct structure', () => {
    const now = '2026-01-01T00:00:00Z';
    const current = { name: 'Alice', score: 42 };
    const filePath = upsertEntity(tmpDir, 'users', 'u1', current, now, 10);

    const entity = readEntity(filePath);
    expect(entity.entityType).toBe('users');
    expect(entity.entityKey).toBe('u1');
    expect(entity.current).toEqual(current);
    expect(entity.history).toEqual([]);
    expect(entity.meta.version).toBe(1);
    expect(entity.meta.firstSeen).toBe(now);
    expect(entity.meta.lastWebhook).toBe(now);
    expect(entity.meta.lastBackfill).toBeNull();
  });

  it('updates existing entity and appends reverse-diff patch to history', () => {
    const t1 = '2026-01-01T00:00:00Z';
    const t2 = '2026-01-02T00:00:00Z';
    const v1 = { name: 'Alice', score: 42 };
    const v2 = { name: 'Alice', score: 99 };

    const filePath = upsertEntity(tmpDir, 'users', 'u1', v1, t1, 10);
    upsertEntity(tmpDir, 'users', 'u1', v2, t2, 10);

    const entity = readEntity(filePath);
    expect(entity.current).toEqual(v2);
    expect(entity.history).toHaveLength(1);
    expect(entity.history[0].ts).toBe(t1);
    expect(entity.history[0].patch.length).toBeGreaterThan(0);
  });

  it('caps history at maxHistory (oldest entries dropped)', () => {
    const base = { value: 0 };
    upsertEntity(tmpDir, 'items', 'i1', base, '2026-01-01T00:00:00Z', 2);

    for (let i = 1; i <= 5; i++) {
      upsertEntity(
        tmpDir,
        'items',
        'i1',
        { value: i },
        `2026-01-0${String(i + 1)}T00:00:00Z`,
        2,
      );
    }

    const filePath = path.join(tmpDir, 'items', 'i1.json');
    const entity = readEntity(filePath);
    expect(entity.history).toHaveLength(2);
  });

  it('increments meta.version on each upsert', () => {
    const filePath = upsertEntity(
      tmpDir,
      'x',
      'k',
      { a: 1 },
      '2026-01-01T00:00:00Z',
      10,
    );
    expect(readEntity(filePath).meta.version).toBe(1);

    upsertEntity(tmpDir, 'x', 'k', { a: 2 }, '2026-01-02T00:00:00Z', 10);
    expect(readEntity(filePath).meta.version).toBe(2);

    upsertEntity(tmpDir, 'x', 'k', { a: 3 }, '2026-01-03T00:00:00Z', 10);
    expect(readEntity(filePath).meta.version).toBe(3);
  });

  it('preserves meta.firstSeen across updates', () => {
    const firstSeen = '2026-01-01T00:00:00Z';
    const filePath = upsertEntity(tmpDir, 'x', 'k', { a: 1 }, firstSeen, 10);
    upsertEntity(tmpDir, 'x', 'k', { a: 2 }, '2026-06-15T00:00:00Z', 10);
    upsertEntity(tmpDir, 'x', 'k', { a: 3 }, '2026-12-31T00:00:00Z', 10);

    expect(readEntity(filePath).meta.firstSeen).toBe(firstSeen);
  });

  it('does not add a history entry when current is identical (no-op diff)', () => {
    const current = { name: 'Alice', score: 42 };
    const filePath = upsertEntity(
      tmpDir,
      'users',
      'u1',
      current,
      '2026-01-01T00:00:00Z',
      10,
    );
    upsertEntity(
      tmpDir,
      'users',
      'u1',
      { ...current },
      '2026-01-02T00:00:00Z',
      10,
    );

    const entity = readEntity(filePath);
    expect(entity.history).toHaveLength(0);
    // Version still increments even on no-op diff
    expect(entity.meta.version).toBe(2);
  });
});

describe('backfillEntity', () => {
  it('creates new entity file when file does not exist', () => {
    const now = '2026-03-01T00:00:00Z';
    const current = { status: 'open' };
    const filePath = backfillEntity(tmpDir, 'tickets', 't1', current, now);

    expect(filePath).not.toBeNull();
    const entity = readEntity(filePath!);
    expect(entity.entityType).toBe('tickets');
    expect(entity.entityKey).toBe('t1');
    expect(entity.current).toEqual(current);
    expect(entity.history).toEqual([]);
    expect(entity.meta.version).toBe(1);
    expect(entity.meta.lastBackfill).toBe(now);
  });

  it('returns null and does NOT overwrite when file already exists', () => {
    const original = { status: 'open' };
    const filePath = upsertEntity(
      tmpDir,
      'tickets',
      't1',
      original,
      '2026-01-01T00:00:00Z',
      10,
    );

    const result = backfillEntity(
      tmpDir,
      'tickets',
      't1',
      { status: 'closed' },
      '2026-02-01T00:00:00Z',
    );
    expect(result).toBeNull();

    // Original data preserved
    const entity = readEntity(filePath);
    expect(entity.current).toEqual(original);
  });

  it('sets meta.lastBackfill', () => {
    const now = '2026-05-05T12:00:00Z';
    const filePath = backfillEntity(tmpDir, 'items', 'i1', { x: 1 }, now);

    const entity = readEntity(filePath!);
    expect(entity.meta.lastBackfill).toBe(now);
  });
});

describe('deleteEntity', () => {
  it('deletes existing file and returns true', () => {
    const filePath = upsertEntity(
      tmpDir,
      'users',
      'u1',
      { a: 1 },
      '2026-01-01T00:00:00Z',
      10,
    );
    expect(fs.existsSync(filePath)).toBe(true);

    const result = deleteEntity(tmpDir, 'users', 'u1');
    expect(result).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('returns false when file does not exist', () => {
    const result = deleteEntity(tmpDir, 'users', 'nonexistent');
    expect(result).toBe(false);
  });
});

describe('writeUnmatched', () => {
  it('creates _unmatched/ directory and writes JSON file', () => {
    const body = { event: 'unknown', data: [1, 2, 3] };
    writeUnmatched(tmpDir, 'webhook-xyz', body);

    const unmatchedDir = path.join(tmpDir, '_unmatched');
    expect(fs.existsSync(unmatchedDir)).toBe(true);

    const files = fs.readdirSync(unmatchedDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('webhook-xyz');

    const written = JSON.parse(
      fs.readFileSync(path.join(unmatchedDir, files[0]), 'utf8'),
    ) as unknown;
    expect(written).toEqual(body);
  });

  it('file name contains the label', () => {
    writeUnmatched(tmpDir, 'my-special-label', { x: 1 });

    const files = fs.readdirSync(path.join(tmpDir, '_unmatched'));
    expect(files[0]).toContain('my-special-label');
  });
});
