/**
 * Integration tests for the OpenClaw DB scan: channel naming reused from
 * the JSONL collector, bucket output format, incremental (session, seq)
 * cursor without double counting, open-hour handling, legacy archives
 * and countedOnly rebuilds.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type * as ConstantsModule from '../../../lib/constants.js';
import type { HourlyBucket } from '../../types/token-metrics.js';
import type { DbCursorState } from './db-cursor.js';
import {
  header,
  inputCount,
  ms,
  T10,
  T11,
  usage,
  useOpenClawDbRoot,
  user,
} from './openclaw-db.fixtures.js';
import { createV23Fixture } from './v23.fixtures.js';

// Each test re-imports the collector's module graph (vi.resetModules) and
// builds a SQLite fixture: well under a second locally, over the 5 s default
// on a loaded Windows CI runner (runs 38014055786, 38141546503).
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

describe('scanOpenClawDb', () => {
  it('attributes usage with the JSONL collector channel names and bucket format', async () => {
    const fx = createV23Fixture(root());
    fx.addHotSession(
      's1',
      [
        header('s1'),
        user('System: Slack message in #ops from Bob: hi'),
        usage(T10, 200),
      ],
      [2],
    );
    fx.addColdSession('s2', [
      header('s2'),
      user('[Subagent Task] work in /repos/acme/widget'),
      usage(T10, 7),
    ]);
    fx.addArchive('s3', [
      header('s3'),
      user(
        'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.',
      ),
      usage(T10, 5),
    ]);
    fx.close();
    const { scanOpenClawDb } = await load();

    const buckets = new Map<string, HourlyBucket>();
    const cursors: DbCursorState = {};
    const stats = scanOpenClawDb({
      dbPath: fx.dbPath,
      sessionsDir: fx.sessionsDir,
      cursors,
      options: { fromMs: 0, toMs: ms(T11) },
      buckets,
      seenModels: new Set(),
    });

    expect(stats.schemaVersion).toBe(23);
    expect(stats.usageCounted).toBe(3);
    const entry =
      buckets.get('2026-06-15T10')?.channels['slack:channel:#ops']?.models[
        'anthropic/claude-sonnet-4-6'
      ];
    expect(entry).toEqual({
      input: { count: 200, cost: 0.0006 },
      output: { count: 50, cost: 0.00075 },
      cacheRead: { count: 0, cost: 0 },
      cacheWrite: { count: 0, cost: 0 },
    });
    expect(
      inputCount(buckets, '2026-06-15T10', 'subagent:repo:acme/widget'),
    ).toBe(7);
    expect(inputCount(buckets, '2026-06-15T10', 'heartbeat')).toBe(5);
    expect(cursors['session:s1']).toEqual({
      lastSeq: 2,
      lastTimestamp: ms(T10),
    });
  });

  it('never double counts across incremental runs and keeps open-hour usage for later', async () => {
    const fx = createV23Fixture(root());
    fx.addHotSession('s1', [
      header('s1'),
      user('Slack message in #ops from B: x'),
      usage(T10, 1),
      usage(T11, 10),
    ]);
    fx.close();
    const { scanOpenClawDb } = await load();
    const cursors: DbCursorState = {};
    const run = (toIso: string) => {
      const buckets = new Map<string, HourlyBucket>();
      scanOpenClawDb({
        dbPath: fx.dbPath,
        sessionsDir: fx.sessionsDir,
        cursors,
        options: { fromMs: 0, toMs: ms(toIso) },
        buckets,
        seenModels: new Set(),
      });
      return buckets;
    };

    const first = run('2026-06-15T11:00:00Z');
    expect(inputCount(first, '2026-06-15T10', 'slack:channel:#ops')).toBe(1);
    expect(first.has('2026-06-15T11')).toBe(false);
    expect(cursors['session:s1']!.lastSeq).toBe(2);

    const second = run('2026-06-15T12:00:00Z');
    expect(second.has('2026-06-15T10')).toBe(false);
    expect(inputCount(second, '2026-06-15T11', 'slack:channel:#ops')).toBe(10);

    expect(run('2026-06-15T12:00:00Z').size).toBe(0);
  });

  it('skips usage before fromMs, reads legacy archives, and rebuilds countedOnly ranges', async () => {
    const fx = createV23Fixture(root());
    fx.addHotSession('s1', [
      header('s1'),
      user('Slack message in #ops from B: x'),
      usage(T10, 1),
      usage(T11, 10),
    ]);
    fx.close();
    fs.writeFileSync(
      path.join(fx.sessionsDir, 'old.jsonl.reset.2026-06-15T12-00-00.000Z'),
      [
        header('old'),
        user('Slack message in #legacy from B: x'),
        usage(T11, 3),
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(fx.sessionsDir, 'pub.jsonl.deleted.2026-06-15.g1.zst'),
      'binary',
    );
    const { scanOpenClawDb } = await load();

    const cursors: DbCursorState = {};
    const buckets = new Map<string, HourlyBucket>();
    const scan = (countedOnly: boolean, into: Map<string, HourlyBucket>) =>
      scanOpenClawDb({
        dbPath: fx.dbPath,
        sessionsDir: fx.sessionsDir,
        cursors,
        options: {
          fromMs: ms('2026-06-15T11:00:00Z'),
          toMs: ms('2026-06-15T12:00:00Z'),
          countedOnly,
        },
        buckets: into,
        seenModels: new Set(),
      });
    scan(false, buckets);
    expect(buckets.has('2026-06-15T10')).toBe(false);
    expect(inputCount(buckets, '2026-06-15T11', 'slack:channel:#ops')).toBe(10);
    expect(inputCount(buckets, '2026-06-15T11', 'slack:channel:#legacy')).toBe(
      3,
    );
    expect(Object.keys(cursors).sort()).toEqual([
      'legacy:old.jsonl.reset.2026-06-15T12-00-00.000Z',
      'session:s1',
    ]);

    const before = structuredClone(cursors);
    const rebuilt = new Map<string, HourlyBucket>();
    scan(true, rebuilt);
    expect(inputCount(rebuilt, '2026-06-15T11', 'slack:channel:#ops')).toBe(10);
    expect(cursors).toEqual(before);
  });
});
