import { describe, expect, it } from 'vitest';

import { fakeOpenclaw } from './fake-openclaw.test-helper.js';
import { configSetBatch, openclawPresent, runCommand } from './openclaw.js';

describe('openclaw helpers', () => {
  it('openclawPresent is false when it cannot start or fails', async () => {
    expect(
      await openclawPresent(() => Promise.reject(new Error('ENOENT'))),
    ).toBe(false);
    expect(
      await openclawPresent(() =>
        Promise.resolve({ code: 1, stdout: '', stderr: '' }),
      ),
    ).toBe(false);
    expect(await openclawPresent(fakeOpenclaw().run)).toBe(true);
  });

  it('configSetBatch does nothing for no sets', async () => {
    const fake = fakeOpenclaw();
    await configSetBatch([], fake.run);
    expect(fake.calls).toEqual([]);
  });

  it('runCommand captures output and exit code, and rejects when it cannot start', async () => {
    const r = await runCommand(process.execPath, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ]);
    expect(r).toEqual({ code: 3, stdout: 'out', stderr: 'err' });
    await expect(
      runCommand('jeeves-scripts-no-such-command', []),
    ).rejects.toThrow();
  });
});
