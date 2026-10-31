/**
 * `punch-list-harvest`: its manifest, dry run unless `--live`,
 * `--print-task`, the worker for this runnable, and the skip with no
 * `punchList` block.
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
    runHarvest:
      vi.fn<
        (config: unknown, flags: unknown, deps: unknown) => Promise<void>
      >(),
    liveHarvestWorker: vi.fn(() => 'worker'),
  });
});
vi.mock('./run.js', () => ({ runHarvest: mocks.runHarvest }));
vi.mock('./worker.js', () => ({ liveHarvestWorker: mocks.liveHarvestWorker }));
vi.mock('../config.js', () => ({ punchListConfig: () => mocks.config }));

import { NO_PUNCH_LIST } from '../runtime.js';
import job, { HARVEST_JOB_ID } from './job.js';

const config = { slack: { account: 'default', channel: 'C000PUNCH01' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config = config;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('punch-list-harvest runnable', () => {
  it('is in the punch-list domain with a disabled, live manifest under its id', () => {
    expect(HARVEST_JOB_ID).toBe('punch-list-harvest');
    expect(job.id).toBe(HARVEST_JOB_ID);
    expect(job.domain).toBe('punch-list');
    expect(manifests[HARVEST_JOB_ID]).toMatchObject({
      enabled: false,
      args: ['--live'],
    });
  });

  it.each([
    [[], { live: false, printTask: false }],
    [['--live'], { live: true, printTask: false }],
    [['--print-task'], { live: false, printTask: true }],
  ])(
    'runs with %j as %j and a worker for this runnable',
    async (args, flags) => {
      await job.run({ args });
      const [gotConfig, gotFlags, deps] = mocks.runHarvest.mock.calls[0] ?? [];
      expect(gotConfig).toBe(config);
      expect(gotFlags).toEqual(flags);
      expect(mocks.liveHarvestWorker).toHaveBeenCalledWith(HARVEST_JOB_ID);
      expect(Object.keys(deps as object).sort()).toEqual([
        'log',
        'now',
        'slack',
        'worker',
      ]);
      expect(deps).toMatchObject({ worker: 'worker' });
    },
  );

  it('skips with no punchList block, by prerequisite and by run', async () => {
    mocks.config = undefined;
    expect(await job.prerequisite?.({ args: [] })).toBe(NO_PUNCH_LIST);
    await job.run({ args: ['--live'] });
    expect(mocks.runHarvest).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      '[skip] no punchList block in the instance config',
    );
  });
});
