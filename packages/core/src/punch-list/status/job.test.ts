/**
 * `punch-list-refresh-status`: its manifest, dry run unless `--live`,
 * live dependencies, and the skip with no `punchList` block.
 */

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const manifests = JSON.parse(
  readFileSync(
    new URL('../../../jobs/punch-list.json', import.meta.url),
    'utf8',
  ),
) as Record<string, { enabled: boolean; args?: string[] }>;

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
  it('is in the punch-list domain with a disabled, live manifest under its id', () => {
    expect(STATUS_JOB_ID).toBe('punch-list-refresh-status');
    expect(job.id).toBe(STATUS_JOB_ID);
    expect(job.domain).toBe('punch-list');
    expect(manifests[STATUS_JOB_ID]).toMatchObject({
      enabled: false,
      args: ['--live'],
    });
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
