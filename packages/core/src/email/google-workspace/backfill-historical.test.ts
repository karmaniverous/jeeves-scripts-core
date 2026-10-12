import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import {
  backfillHistorical,
  type BackfillHistoricalDeps,
  backfillHistoricalDeps,
} from './backfill-historical.js';

// Thread caches written by the live run land under a temp base directory.
useTempConfig();

const NOW = new Date('2026-06-01T00:00:00.000Z');
let dir: string;
let runner: ReturnType<typeof fakeRunnerClient>;
let logs: string[];
let gogCalls: string[][];

const deps = (
  over: Partial<BackfillHistoricalDeps> = {},
): BackfillHistoricalDeps => ({
  emailConfig: () => ({
    reportOnly: true,
    digest: { slackChannelId: '' },
    backfill: { accounts: ['me@example.com'], lookbackDays: 30, windowDays: 7 },
  }),
  requireGog: () => true,
  gog: (args) => {
    gogCalls.push(args);
    return JSON.stringify({ threads: [{ id: 't1', labels: ['INBOX'] }] });
  },
  runner: () => runner.client,
  eventsDir: path.join(dir, 'events'),
  now: () => NOW,
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-hist-'));
  runner = fakeRunnerClient();
  logs = [];
  gogCalls = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('backfillHistorical', () => {
  it('reports a dry run without moving the cursor', () => {
    backfillHistorical([], deps());
    expect(logs).toContain('Mode: DRY-RUN');
    expect(logs).toContain('Accounts: me@example.com');
    expect(logs).toContain('Lookback: 30 days, window: 7 days');
    expect(logs).toContain('reportOnly: no Gmail label actions enqueued');
    expect(logs).toContain('  Found:         1');
    expect(logs).toContain('\nRe-run with --live to process and advance.');
    expect(runner.state.size).toBe(0);
    expect(fs.existsSync(path.join(dir, 'events'))).toBe(true);
    expect(runner.closed()).toBe(true);
  });

  it('processes live, advancing the cursor, and honours --accounts', () => {
    backfillHistorical(['--live', '--accounts', 'other@example.com'], deps());
    expect(logs).toContain('Mode: LIVE');
    expect(logs).toContain('Accounts: other@example.com');
    expect(logs.some((l) => l.startsWith('  Cursor:'))).toBe(true);
    expect(gogCalls[0]).toContain('other@example.com');
  });

  it('stops at the lookback limit', () => {
    runner.client.setState(
      'email-backfill',
      'cursor-me@example.com',
      '2026-04-01T00:00:00.000Z',
    );
    backfillHistorical(['--live'], deps());
    expect(logs).toContain('  Lookback limit reached: nothing to do');
  });

  it('fails when gog has no credential', () => {
    const d = deps({
      requireGog: () => {
        throw new Error('no gog');
      },
    });
    expect(() => {
      backfillHistorical([], d);
    }).toThrow('no gog');
  });
});

describe('backfillHistoricalDeps', () => {
  it('reads the email config at run time', () => {
    expect(backfillHistoricalDeps().emailConfig().reportOnly).toBe(true);
  });
});
