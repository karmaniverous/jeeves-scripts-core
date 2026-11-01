import { parseRunnableArgs } from '@karmaniverous/jeeves';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { SyncEntrySchema } from './lib/config.js';
import { emptySummary } from './lib/summary.js';
import {
  googleDriveSync,
  type GoogleDriveSyncDeps,
  googleDriveSyncDeps,
  googleDriveSyncFlags,
} from './sync.js';

const flagsOf = (args: string[]) =>
  parseRunnableArgs(args, googleDriveSyncFlags);

let runner: ReturnType<typeof fakeRunnerClient>;
let sigterm: (() => void) | undefined;
let logs: string[];

const entry = (account: string) =>
  SyncEntrySchema.parse({
    account,
    targetDir: `google-drive/${account}`,
    pathResolution: { domains: ['example.com'] },
  });

const deps = (
  over: Partial<GoogleDriveSyncDeps> = {},
): GoogleDriveSyncDeps => ({
  config: () =>
    ({ syncs: [entry('a@example.com'), entry('b@example.com')] }) as ReturnType<
      GoogleDriveSyncDeps['config']
    >,
  contentDir: '/content',
  runner: () => runner.client,
  runSyncs: vi.fn(
    (
      syncs: { account: string }[],
      _r,
      options: { live: boolean; shouldStop: () => boolean },
    ) => {
      sigterm?.();
      expect(options.shouldStop()).toBe(true);
      return Promise.resolve(
        syncs.map((s) => emptySummary(s.account, options.live)),
      );
    },
  ),
  onSigterm: (h) => {
    sigterm = h;
  },
  startedAt: () => 0,
  ...over,
});

beforeEach(() => {
  runner = fakeRunnerClient();
  sigterm = undefined;
  logs = [];
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('googleDriveSync', () => {
  it('skips without configured syncs', async () => {
    await googleDriveSync(flagsOf([]), deps({ config: () => null }));
    expect(logs).toEqual(['[skip] no googleDrive syncs configured']);
    expect(runner.closed()).toBe(false);
  });

  it('runs the selected syncs, stops on SIGTERM and reports JR_RESULT', async () => {
    const d = deps();
    await googleDriveSync(
      flagsOf(['--live', '--account', 'B@example.com', '--allow-mass-delete']),
      d,
    );
    expect(d.runSyncs).toHaveBeenCalledWith(
      [expect.objectContaining({ account: 'b@example.com' })],
      runner.client,
      expect.objectContaining({ live: true, allowMassDelete: true }),
    );
    expect(logs).toContain(
      'SIGTERM: finishing the current item, then stopping',
    );
    expect(logs.find((l) => l.startsWith('JR_RESULT:'))).toContain(
      'b@example.com live',
    );
    expect(process.exitCode).toBe(0);
    expect(runner.closed()).toBe(true);
  });

  it('resets ledger state, saying what it would reset in a dry run', async () => {
    await googleDriveSync(flagsOf(['--reset-state']), deps());
    expect(logs).toEqual([
      'WOULD RESET a@example.com: 0 ledger records',
      'WOULD RESET b@example.com: 0 ledger records',
    ]);
    await googleDriveSync(
      flagsOf(['--reset-state', '--live', '--account', 'a@example.com']),
      deps(),
    );
    expect(logs).toContain('RESET a@example.com: 0 ledger records');
  });

  it('synthesizes an entry for an unconfigured account in a dry run', async () => {
    const d = deps({ config: () => null });
    await googleDriveSync(
      flagsOf(['--account', 'x@other.org', '--domains', 'other.org, more.org']),
      d,
    );
    expect(d.runSyncs).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          account: 'x@other.org',
          pathResolution: expect.objectContaining({
            domains: ['other.org', 'more.org'],
          }) as unknown,
        }),
      ],
      runner.client,
      expect.objectContaining({ live: false }),
    );
  });
});

describe('googleDriveSyncDeps', () => {
  it('has no googleDrive block in the test config', () => {
    expect(googleDriveSyncDeps().config()).toBeNull();
  });
});
