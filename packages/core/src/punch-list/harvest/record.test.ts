import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { reportItem } from '../punch-list.test-helper.js';
import {
  type HarvestRecord,
  recordPath,
  undeliveredRecords,
  writeRecord,
} from './record.js';

const record = (at: string, delivered: boolean): HarvestRecord => ({
  at,
  since: '2026-10-17T21:47:00.000Z',
  report: { items: [reportItem()], summary: 's' },
  added: [reportItem()],
  skipped: [],
  delivered,
});

describe('harvest records', () => {
  it('names a record by its run start, safe for any file system', () => {
    expect(recordPath('/d', new Date('2026-10-18T21:47:00.123Z'))).toBe(
      join('/d', 'harvest', '2026-10-18T21-47-00Z.json'),
    );
  });

  it('lists undelivered records oldest first, ignoring delivered ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-record-'));
    expect(undeliveredRecords(dir)).toEqual([]);
    for (const [at, delivered] of [
      ['2026-10-19T21:47:00.000Z', false],
      ['2026-10-17T21:47:00.000Z', true],
      ['2026-10-18T21:47:00.000Z', false],
    ] as const) {
      writeRecord(recordPath(dir, new Date(at)), record(at, delivered));
    }
    expect(undeliveredRecords(dir).map((r) => r.record.at)).toEqual([
      '2026-10-18T21:47:00.000Z',
      '2026-10-19T21:47:00.000Z',
    ]);
  });

  it('rejects a corrupt record instead of skipping it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-record-'));
    mkdirSync(join(dir, 'harvest'));
    writeFileSync(
      join(dir, 'harvest', 'x.json'),
      JSON.stringify({ delivered: false }),
    );
    expect(() => undeliveredRecords(dir)).toThrow(
      /"path": \[\s*"at"\s*\][\s\S]*"path": \[\s*"skipped"\s*\]/,
    );
  });
});
