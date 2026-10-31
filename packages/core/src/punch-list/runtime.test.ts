import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { testConfig } from './punch-list.test-helper.js';
import { liveJobDeps, todayFor } from './runtime.js';

describe('liveJobDeps', () => {
  it('prefixes every log line with the job id', () => {
    const lines: string[] = [];
    const deps = liveJobDeps(testConfig({}), 'acme-x', (l) => lines.push(l));
    deps.log('hello');
    expect(lines).toEqual(['[acme-x] hello']);
  });
});

describe('todayFor', () => {
  it('resolves the zoned day, store options and today’s URL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-rt-'));
    const serverConfig = join(dir, 'server.json');
    writeFileSync(
      serverConfig,
      JSON.stringify({ publicUrl: 'https://h', roots: { r: dir } }),
    );
    const config = testConfig({
      dir: join(dir, 'pl'),
      serverConfig,
      retentionDays: 7,
      lockFile: '/base/state/punch-list/punch-list.lock',
    });
    const today = todayFor(config, new Date('2026-10-18T20:00:00Z'));
    expect(today.day).toBe('2026-10-19');
    expect(today.store).toEqual({
      dir: join(dir, 'pl'),
      today: '2026-10-19',
      retentionDays: 7,
      lockFile: '/base/state/punch-list/punch-list.lock',
    });
    expect(today.url).toBe('https://h/browse/r/pl/2026-10-19.md');
  });
});
