/**
 * `punch-list-refresh-status`: its manifest, dry run unless `--live`,
 * live dependencies, and the skip with no `punchList` block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: { config: unknown } = { config: undefined };
  return Object.assign(state, {
    runStatus:
      vi.fn<
        (config: unknown, flags: unknown, deps: unknown) => Promise<void>
      >(),
  });
});
vi.mock('./run.js', () => ({ runStatus: mocks.runStatus }));
vi.mock('../config.js', () => ({ punchListConfig: () => mocks.config }));

import { liveInstallEnv } from '../github/install.js';
import { punchListManifest } from '../punch-list.test-helper.js';
import { NO_PUNCH_LIST } from '../runtime.js';
import job, { STATUS_JOB_ID } from './job.js';

const config = { slack: { account: 'default', channel: 'C000PUNCH01' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = config;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('punch-list-refresh-status runnable', () => {
  it('is in the punch-list domain with a disabled, dry-run manifest under its id', () => {
    expect(STATUS_JOB_ID).toBe('punch-list-refresh-status');
    expect(job.id).toBe(STATUS_JOB_ID);
    expect(job.domain).toBe('punch-list');
    const manifest = punchListManifest(STATUS_JOB_ID);
    expect(manifest).toMatchObject({ enabled: false });
    // Dry run until the instance's enabling delta adds `--live` (spec 2.1).
    expect(manifest).not.toHaveProperty('args');
  });

  it.each([
    [[], false],
    [['--live'], true],
  ])('runs with %j as live=%s and live dependencies', async (args, live) => {
    await job.run({ args });
    const [gotConfig, flags, deps] = mocks.runStatus.mock.calls[0] ?? [];
    expect(gotConfig).toBe(config);
    expect(flags).toEqual({ live });
    expect(deps).toMatchObject({ install: liveInstallEnv });
    expect(Object.keys(deps as object).sort()).toEqual([
      'github',
      'install',
      'log',
      'now',
      'slack',
    ]);
  });

  it('skips with no punchList block, by prerequisite and by run', async () => {
    mocks.config = undefined;
    expect(await job.prerequisite?.({ args: [] })).toBe(NO_PUNCH_LIST);
    await job.run({ args: ['--live'] });
    expect(mocks.runStatus).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      '[skip] no punchList block in the instance config',
    );
  });

  it('passes its prerequisite with the block', async () => {
    expect(await job.prerequisite?.({ args: [] })).toBe(true);
  });
});
