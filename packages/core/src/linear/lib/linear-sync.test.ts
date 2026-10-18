import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRunnableArgs } from '../../lib/args.js';
import { fakeRunnerClient } from '../../lib/fake-runner-client.test-helper.js';
import { linearBackfill, linearBackfillFlags } from '../backfill.js';
import {
  type LinearJobDeps,
  linearJobDeps,
  RATE_LIMIT_MS,
  syncLinear,
} from './linear-sync.js';

const flagsOf = (args: string[]) =>
  parseRunnableArgs(args, linearBackfillFlags);

let dir: string;
let runner: ReturnType<typeof fakeRunnerClient>;
let seen: unknown[][];

async function* gen(
  nodes: Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
  await Promise.resolve();
  yield* nodes;
}

const issues = [
  { identifier: 'ACME-1', updatedAt: '2026-01-02' },
  { identifier: 'ACME-2', updatedAt: '2026-01-03' },
];
const comments = [
  { id: 'c1', updatedAt: '2026-01-05', issue: { identifier: 'ACME-1' } },
];

const deps = (over: Partial<LinearJobDeps> = {}): LinearJobDeps => ({
  configPath: path.join(dir, 'linear.json'),
  loadConfig: () => ({ apiKey: 'k', apiUrl: 'https://linear.test/graphql' }),
  paginate: {
    issue: (...a) => {
      seen.push(['issue', ...a.slice(1)]);
      return gen(issues);
    },
    comment: (...a) => {
      seen.push(['comment', ...a.slice(1)]);
      return gen(comments);
    },
  },
  domainDir: path.join(dir, 'linear'),
  maxHistory: 50,
  now: () => '2026-02-01T00:00:00.000Z',
  sleep: () => Promise.resolve(),
  runner: () => runner.client,
  ...over,
});

const exists = (type: string, key: string) =>
  fs.existsSync(path.join(dir, 'linear', type, `${key}.json`));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-sync-'));
  runner = fakeRunnerClient();
  seen = [];
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('syncLinear', () => {
  it('skips when the Linear config is missing', async () => {
    const loadConfig = () => {
      throw new Error('ENOENT');
    };
    await syncLinear('issue', deps({ loadConfig }));
    expect(console.log).toHaveBeenCalledWith(
      `[skip] Linear config not found at ${path.join(dir, 'linear.json')}`,
    );
    expect(runner.closed()).toBe(false);
  });

  it('upserts issues from the cursor and advances it to the latest updatedAt', async () => {
    runner.client.setState('linear', 'sync-issues-cursor', '2026-01-01');
    const sleep = vi.fn(() => Promise.resolve());
    await syncLinear('issue', deps({ sleep }));
    expect(seen).toEqual([['issue', undefined, '2026-01-01']]);
    expect(exists('issue', 'ACME-1') && exists('issue', 'ACME-2')).toBe(true);
    expect(runner.client.getState('linear', 'sync-issues-cursor')).toBe(
      '2026-01-03',
    );
    expect(sleep).toHaveBeenCalledWith(RATE_LIMIT_MS);
    expect(console.log).toHaveBeenCalledWith(
      '[sync-issues] cursor \u2192 2026-01-03',
    );
    expect(runner.closed()).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('upserts enriched comments with no cursor yet', async () => {
    await syncLinear('comment', deps());
    expect(seen).toEqual([['comment', undefined]]);
    const stored = JSON.parse(
      fs.readFileSync(path.join(dir, 'linear', 'comment', 'c1.json'), 'utf8'),
    ) as { current: Record<string, unknown> };
    expect(stored.current._issueIdentifier).toBe('ACME-1');
    expect(runner.client.getState('linear', 'sync-comments-cursor')).toBe(
      '2026-01-05',
    );
  });

  it('counts entities without a key or with a failed write, keeps the cursor and sets exit code 1', async () => {
    fs.mkdirSync(path.join(dir, 'linear'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'linear', 'issue'), '');
    const paginate = {
      issue: () => gen([{ title: 'no id' }, { identifier: 'ACME-9' }]),
      comment: () => gen([]),
    };
    await syncLinear('issue', deps({ paginate }));
    expect(console.error).toHaveBeenCalledWith(
      '[sync-issues] issue missing identifier, skipping',
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[sync-issues\] error ACME-9: /),
    );
    expect(console.log).toHaveBeenCalledWith(
      '[sync-issues] end 2026-02-01T00:00:00.000Z \u2014 upserted=0 failed=2',
    );
    expect(runner.state.size).toBe(0);
    expect(process.exitCode).toBe(1);
    expect(runner.closed()).toBe(true);
  });
});

describe('linearBackfill', () => {
  it.each([
    [
      ['--type', 'cycle'],
      '[error] --type "cycle" is not supported (only "issue" or "comment")',
    ],
    [[], '[error] --team <key> is required for --type issue'],
  ])('rejects %j with exit code 1', async (args, message) => {
    await linearBackfill(flagsOf(args), deps());
    expect(console.error).toHaveBeenCalledWith(message);
    expect(process.exitCode).toBe(1);
    expect(seen).toEqual([]);
  });

  it('skips when the Linear config is missing', async () => {
    const loadConfig = () => {
      throw new Error('bad');
    };
    await linearBackfill(flagsOf(['--team', 'ACME']), deps({ loadConfig }));
    expect(seen).toEqual([]);
  });

  it('only logs in a dry run', async () => {
    await linearBackfill(flagsOf(['--team', 'ACME']), deps());
    expect(seen).toEqual([['issue', 'ACME']]);
    expect(console.log).toHaveBeenCalledWith('[backfill] dry-run ACME-1');
    expect(console.log).toHaveBeenCalledWith(
      '[backfill] done \u2014 created=0 skipped=2 failed=0',
    );
    expect(exists('issue', 'ACME-1')).toBe(false);
  });

  it('writes new entities live and skips existing ones', async () => {
    fs.mkdirSync(path.join(dir, 'linear', 'comment'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'linear', 'comment', 'c1.json'), '{}');
    await linearBackfill(flagsOf(['--type', 'comment', '--live']), deps());
    expect(console.log).toHaveBeenCalledWith(
      '[backfill] skip   comment/c1 (exists)',
    );
    await linearBackfill(flagsOf(['--team', 'ACME', '--live']), deps());
    expect(exists('issue', 'ACME-2')).toBe(true);
    expect(console.log).toHaveBeenCalledWith('[backfill] created ACME-1');
    expect(console.log).toHaveBeenCalledWith(
      '[backfill] team=(all) type=comment live=true',
    );
  });
});

describe('linearJobDeps', () => {
  it('resolves the archive directory and credentials path from config', () => {
    const live = linearJobDeps();
    expect(path.basename(live.domainDir)).toBe('linear');
    expect(path.basename(live.configPath)).toBe('linear.json');
    expect(live.maxHistory).toBe(50);
  });
});
