/**
 * `github-sync-files` and the config (Decision 76): with no delta it
 * passes `config check` and skips before any `gh` call; with an invalid
 * delta field, `config check` fails and so does the run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configCheck } from '../config/check.js';
import { useConfigFile } from '../config/config-file.test-helper.js';
import syncFilesJob, { SYNC_FILES_SKIP } from './sync-files.js';

const files = [{ source: 'a.md', target: 'a.md' }];
const owners = [{ owner: 'example-org', type: 'org' }];

describe('github-sync-files and its job delta', () => {
  const write = useConfigFile();
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes config check and skips with no delta', async () => {
    expect(configCheck(write({})).ok).toBe(true);
    await syncFilesJob.run({ args: ['--live'] });
    expect(console.log).toHaveBeenCalledWith(SYNC_FILES_SKIP);
  });

  it.each([
    [
      'a source outside the repo',
      { files: [{ source: '../x.md', target: 'x.md' }], owners },
      /must not contain a \.\. segment/,
    ],
    [
      'an unknown owner type',
      { files, owners: [{ owner: 'o', type: 'team' }] },
      /type/,
    ],
    ['an empty account', { files, owners, account: '' }, /account/],
    [
      'a ruleset without rules',
      {
        files,
        owners,
        ruleset: { name: 'n', target: 'branch', enforcement: 'active' },
      },
      /rules/,
    ],
  ])('fails config check and the run on %s', (_what, delta, message) => {
    const result = configCheck(write({ jobs: { 'github-sync-files': delta } }));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(message);
    expect(() => syncFilesJob.run({ args: ['--live'] })).toThrow(message);
    expect(console.log).not.toHaveBeenCalledWith(SYNC_FILES_SKIP);
  });
});
