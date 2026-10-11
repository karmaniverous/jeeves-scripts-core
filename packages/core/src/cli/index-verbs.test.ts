/**
 * The CLI verbs' failure and exit-code paths, with each verb's
 * implementation stubbed: `<verb>: FAILED: <error>` and exit code 1 on a
 * throw, the verb's own exit code passed through, and init's skills
 * hand-off with and without OpenClaw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runJob: vi.fn(),
  listRunnables: vi.fn(),
  initRepo: vi.fn(),
  runSkills: vi.fn(),
  openclawPresent: vi.fn(),
  instanceConfigCheck: vi.fn(),
}));
vi.mock('./config-check.js', () => ({
  instanceConfigCheck: mocks.instanceConfigCheck,
}));
vi.mock('./run.js', () => ({ runJob: mocks.runJob }));
vi.mock('./list.js', () => ({
  listRunnables: mocks.listRunnables,
  formatList: () => ['line'],
}));
vi.mock('./init.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  initRepo: mocks.initRepo,
  formatInit: () => ['written'],
}));
vi.mock('./skills.js', () => ({ runSkills: mocks.runSkills }));
vi.mock('./openclaw.js', () => ({ openclawPresent: mocks.openclawPresent }));
vi.mock('./package-info.js', () => ({ coreVersion: () => '9.9.9' }));

import { main } from './index.js';

const root = '/instance';
const cli = (...args: string[]) =>
  main({ root, argv: ['node', 'jeeves-scripts', ...args] });

let errors: string[];
let logs: string[];
beforeEach(() => {
  process.exitCode = undefined;
  errors = [];
  logs = [];
  vi.spyOn(console, 'error').mockImplementation((m: string) => {
    errors.push(m);
  });
  vi.spyOn(console, 'log').mockImplementation((m: string) => {
    logs.push(m);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  process.exitCode = undefined;
});

describe('CLI verb failures and exit codes', () => {
  it('run: passes a non-zero exit code through and reports a throw', async () => {
    mocks.runJob.mockResolvedValueOnce(3);
    await expect(cli('run', 'x-post', 'karma')).resolves.toBe(3);
    expect(mocks.runJob).toHaveBeenCalledWith(expect.any(String), 'x-post', [
      'karma',
    ]);
    process.exitCode = undefined;
    mocks.runJob.mockRejectedValueOnce(new Error('Unknown runnable id: nope'));
    await expect(cli('run', 'nope')).resolves.toBe(1);
    expect(errors).toContain('run: FAILED: Unknown runnable id: nope');
  });

  it('list: reports a registration error', async () => {
    mocks.listRunnables.mockRejectedValueOnce(new Error('bad manifest'));
    await expect(cli('list')).resolves.toBe(1);
    expect(errors).toContain('list: FAILED: bad manifest');
  });

  it('init: reports a failure, and installs skills only where OpenClaw is', async () => {
    mocks.initRepo.mockImplementationOnce(() => {
      throw new Error('not empty');
    });
    await expect(cli('init')).resolves.toBe(1);
    expect(errors).toContain('init: FAILED: not empty');

    process.exitCode = undefined;
    mocks.initRepo.mockReturnValue({});
    mocks.openclawPresent.mockResolvedValueOnce(false);
    await expect(cli('init')).resolves.toBe(0);
    expect(logs.at(-1)).toMatch(/^OpenClaw is not on this host/);

    mocks.openclawPresent.mockResolvedValueOnce(true);
    mocks.runSkills.mockResolvedValueOnce(2);
    await expect(cli('init')).resolves.toBe(1);
    expect(mocks.runSkills).toHaveBeenCalledWith('install', {
      root: expect.any(String) as unknown,
    });
  });

  it('reports an error no verb caught as the program failing', async () => {
    mocks.instanceConfigCheck.mockRejectedValueOnce(new Error('disk gone'));
    await expect(cli('config', 'check')).resolves.toBe(1);
    expect(errors).toContain('jeeves-scripts: FAILED: disk gone');
  });

  it('skills: passes the action exit code through', async () => {
    mocks.runSkills.mockResolvedValueOnce(4);
    await expect(cli('skills', 'install', '-y')).resolves.toBe(4);
    expect(mocks.runSkills).toHaveBeenCalledWith(
      'install',
      expect.objectContaining({ yes: true }),
    );
  });
});
