/**
 * Tests for the collector's incremental OpenClaw DB step: refuses without
 * a stored cursor (would double count), resumes from a stored cursor, and
 * fails loudly on a wrong-schema DB.
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type * as ConstantsModule from '../../../lib/constants.js';
import type { HourlyBucket } from '../../types/token-metrics.js';
import {
  header,
  inputCount,
  ms,
  T10,
  T11,
  usage,
  useOpenClawDbRoot,
} from './openclaw-db.fixtures.js';
import { createV23Fixture } from './v23.fixtures.js';

// Each test re-imports the collector's module graph (vi.resetModules) and
// builds a SQLite fixture: well under a second locally, over the 5 s default
// on a loaded Windows CI runner.
vi.setConfig({ testTimeout: 30_000 });

const root = useOpenClawDbRoot();

async function load() {
  vi.resetModules();
  vi.doMock(
    '../../../lib/constants.js',
    async (importOriginal: () => Promise<typeof ConstantsModule>) => {
      const actual = await importOriginal();
      return {
        ...actual,
        constants: () => ({
          ...actual.constants(),
          TOKEN_RATES_PATH: path.join(root(), 'token-rates.json'),
        }),
      };
    },
  );
  return {
    ...(await import('./scan-openclaw-db.js')),
    ...(await import('./collect-openclaw.js')),
  };
}

describe('collectOpenClawDb', () => {
  it('refuses without a stored cursor (non-zero exit, nothing scanned)', async () => {
    const fx = createV23Fixture(root());
    fx.addHotSession('s1', [header('s1'), usage(T10)]);
    fx.close();
    const { collectOpenClawDb } = await load();
    const buckets = new Map<string, HourlyBucket>();

    const result = collectOpenClawDb({
      dbPath: fx.dbPath,
      sessionsDir: fx.sessionsDir,
      rawCursor: null,
      cutoffMs: ms(T11),
      buckets,
      seenModels: new Set(),
    });

    expect(result).toBeNull();
    expect(buckets.size).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  it('collects incrementally from a stored cursor', async () => {
    const fx = createV23Fixture(root());
    fx.addHotSession('s1', [header('s1'), usage(T10, 1), usage(T10, 2)]);
    fx.close();
    const { collectOpenClawDb } = await load();
    const buckets = new Map<string, HourlyBucket>();

    const result = collectOpenClawDb({
      dbPath: fx.dbPath,
      sessionsDir: fx.sessionsDir,
      rawCursor: JSON.stringify({
        'session:s1': { lastSeq: 1, lastTimestamp: 0 },
      }),
      cutoffMs: ms(T11),
      buckets,
      seenModels: new Set(),
    });

    expect(inputCount(buckets, '2026-06-15T10', 'unknown')).toBe(2);
    expect(result?.['session:s1']?.lastSeq).toBe(2);
  });

  it('throws on a wrong-schema DB before collecting anything', async () => {
    const fx = createV23Fixture(root(), 25);
    fx.close();
    const { collectOpenClawDb } = await load();

    expect(() =>
      collectOpenClawDb({
        dbPath: fx.dbPath,
        sessionsDir: fx.sessionsDir,
        rawCursor: '{}',
        cutoffMs: ms(T11),
        buckets: new Map(),
        seenModels: new Set(),
      }),
    ).toThrow(/expected user_version 23 or 24, found 25/);
  });
});
