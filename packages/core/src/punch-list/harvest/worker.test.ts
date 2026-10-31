import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runner = vi.hoisted(() => ({ dispatchSession: vi.fn() }));
vi.mock('@karmaniverous/jeeves-runner', () => runner);
vi.mock('../../lib/constants.js', () => ({
  constants: () => ({ SPAWN_WORKER_PATH: '/spawn-worker.js' }),
}));

import { liveHarvestWorker } from './worker.js';

const reportFile = (): string =>
  join(mkdtempSync(join(tmpdir(), 'pl-worker-')), 'run.json');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('liveHarvestWorker', () => {
  it('dispatches with low thinking and returns the report the worker wrote', async () => {
    const file = reportFile();
    runner.dispatchSession.mockImplementation(() => {
      writeFileSync(file, '{"items":[],"summary":"s"}');
      return Promise.resolve({ exitCode: 0, stdout: '' });
    });
    await expect(liveHarvestWorker('acme-h')('TASK', file)).resolves.toBe(
      '{"items":[],"summary":"s"}',
    );
    expect(runner.dispatchSession).toHaveBeenCalledWith(
      'TASK',
      { jobId: 'acme-h', label: 'acme-h', thinking: 'low' },
      '/spawn-worker.js',
    );
  });

  it('fails when the worker exits non-zero or writes no report', async () => {
    runner.dispatchSession.mockResolvedValue({ exitCode: 1, stdout: '' });
    await expect(
      liveHarvestWorker('acme-h')('T', reportFile()),
    ).rejects.toThrow('harvest worker exited 1');
    runner.dispatchSession.mockResolvedValue({ exitCode: 0, stdout: '' });
    await expect(
      liveHarvestWorker('acme-h')('T', reportFile()),
    ).rejects.toThrow(/wrote no report/);
  });
});
