/**
 * Tests for the OpenClaw command owner on Slack: the first `slack:<user>`
 * entry of `commands.ownerAllowFrom` wins; other channels, non-user ids,
 * legacy forms and non-strings are skipped; the config is read through
 * core's `findInOpenclawConfig`.
 */

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: {} }));

vi.mock('../../lib/openclaw-config.js', () => ({
  findInOpenclawConfig: <T>(pick: (config: unknown) => T | undefined) =>
    pick(mocks.config),
}));

const { readSlackOwner, slackOwnerFrom } = await import('./owner.js');

describe('slackOwnerFrom', () => {
  it.each<[unknown[] | undefined, string | undefined]>([
    [['slack:U0ABCDEF12'], 'U0ABCDEF12'],
    [['telegram:123', ' slack:w0enterprise '], 'W0ENTERPRISE'],
    [['SLACK:U0ABC', 'slack:U0DEF'], 'U0ABC'],
    [['slack:C0CHANNEL', 'slack:U0LATER'], 'U0LATER'],
    [['slack:user:U0LEGACY'], undefined],
    [[42, null, 'discord:1'], undefined],
    [['slack:U0'], undefined],
    [[], undefined],
    [undefined, undefined],
  ])('%j -> %s', (entries, owner) => {
    expect(slackOwnerFrom(entries)).toBe(owner);
  });
});

describe('readSlackOwner', () => {
  it('reads commands.ownerAllowFrom from the OpenClaw config', () => {
    mocks.config = { commands: { ownerAllowFrom: ['slack:U0OWNER'] } };
    expect(readSlackOwner()).toBe('U0OWNER');
  });

  it.each([
    [{}],
    [{ commands: {} }],
    [{ commands: { ownerAllowFrom: 'slack:U0OWNER' } }],
  ])('finds no owner in %j', (config) => {
    mocks.config = config;
    expect(readSlackOwner()).toBeUndefined();
  });
});
