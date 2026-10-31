/**
 * Both punch-list runnables and the config (Decision 76): with no
 * `punchList` block, `config check` passes and both skip with exit 0;
 * with an invalid one, `config check`, their prerequisites and their runs
 * all fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configCheck } from '../config/check.js';
import { useConfigFile } from '../config/config-file.test-helper.js';
import harvestJob from './harvest/job.js';
import statusJob from './status/job.js';

const jobs = [statusJob, harvestJob];

describe('the punch-list runnables and the punchList block', () => {
  const write = useConfigFile();
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes config check and skips both with no block', async () => {
    expect(configCheck(write({})).ok).toBe(true);
    for (const job of jobs) {
      expect(await job.prerequisite?.({ args: [] })).toBe(
        'no punchList block in the instance config',
      );
      await job.run({ args: ['--live'] });
    }
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith(
      '[skip] no punchList block in the instance config',
    );
  });

  it.each([
    ['a missing dir', { timeZone: 'UTC' }, /punchList\.dir/],
    [
      'an unknown time zone',
      { dir: '/x', timeZone: 'Mars/Base' },
      /timeZone must be an IANA time zone/,
    ],
  ])(
    'fails config check, the prerequisites and the runs on %s',
    async (_what, punchList, message) => {
      const result = configCheck(write({ punchList }));
      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(message);
      for (const job of jobs) {
        expect(() => job.prerequisite?.({ args: [] })).toThrow(message);
        await expect(job.run({ args: ['--live'] })).rejects.toThrow(message);
      }
    },
  );
});
