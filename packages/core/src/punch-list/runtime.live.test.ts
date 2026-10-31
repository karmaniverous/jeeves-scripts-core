/**
 * The live run dependencies and the opt-in check: `liveJobDeps` creates
 * the Slack port for the configured account only when asked, logs through
 * `console.log` by default with the runnable id, and reads the clock;
 * `punchListPrerequisite` passes with a block and names the skip without.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  liveSlack: vi.fn((account: string) => ({ account })),
}));
vi.mock('./slack.js', () => ({ liveSlack: mocks.liveSlack }));

import { testConfig } from './punch-list.test-helper.js';
import {
  liveJobDeps,
  NO_PUNCH_LIST,
  punchListPrerequisite,
} from './runtime.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('liveJobDeps', () => {
  it("creates the configured account's Slack port on first use only", () => {
    const deps = liveJobDeps(
      testConfig({ slack: { channel: 'C000PUNCH01', account: 'ops' } }),
      'acme-x',
    );
    expect(mocks.liveSlack).not.toHaveBeenCalled();
    expect(deps.slack()).toEqual({ account: 'ops' });
    expect(mocks.liveSlack).toHaveBeenCalledExactlyOnceWith('ops');
  });

  it('logs to console.log with the runnable id by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    liveJobDeps(testConfig(), 'punch-list-harvest').log('hello');
    expect(log).toHaveBeenCalledExactlyOnceWith('[punch-list-harvest] hello');
  });

  it('reads the current time', () => {
    vi.useFakeTimers({ now: new Date('2026-10-18T21:47:00Z') });
    expect(liveJobDeps(testConfig(), 'j').now().toISOString()).toBe(
      '2026-10-18T21:47:00.000Z',
    );
  });
});

describe('punchListPrerequisite', () => {
  it('passes with a block and names the skip without one', () => {
    expect(punchListPrerequisite(testConfig())).toBe(true);
    expect(punchListPrerequisite(undefined)).toBe(NO_PUNCH_LIST);
    expect(NO_PUNCH_LIST).toBe('no punchList block in the instance config');
  });
});
