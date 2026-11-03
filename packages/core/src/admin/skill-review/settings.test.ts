/**
 * Tests for the review's settings from a validated `skillReview` block:
 * every value carried through, the report directory (configured, else the
 * report channel's `homeDir`; required for a DM or a channel without
 * one), directories absolute on this host, and the posting account
 * checked against the gateway's (Decision 76: each problem fails the run
 * and is reported by `doctor`).
 */

import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { skillReviewSchema } from '../../config/skill-review-schema.js';
import { resolveSettings, type SettingsDeps } from './settings.js';

const block = (over: Record<string, unknown> = {}) =>
  skillReviewSchema.parse({
    reportChannel: 'C0REVIEW',
    timezone: 'America/Chicago',
    serverKey: 'skill-review-report',
    ...over,
  });

const deps = (over: Partial<SettingsDeps> = {}): SettingsDeps => ({
  channelHomeDir: (id) => (id === 'C0REVIEW' ? '/srv/review' : undefined),
  slackAccounts: () => ['default', 'work'],
  isAbsolute: (p) => path.posix.isAbsolute(p),
  ...over,
});

describe('resolveSettings', () => {
  it("takes every value from the block, the report channel's homeDir as the directory", () => {
    expect(resolveSettings(block(), deps())).toEqual({
      reportChannel: 'C0REVIEW',
      reportAccount: 'default',
      outputDir: '/srv/review',
      outputDirSource: 'homeDir',
      timeZone: 'America/Chicago',
      serverKeyName: 'skill-review-report',
      budgetAlertPercent: 90,
    });
  });

  it('prefers a configured outputDir, account and threshold', () => {
    expect(
      resolveSettings(
        block({
          outputDir: '/srv/out',
          reportAccount: 'work',
          budgetAlertPercent: 75,
        }),
        deps(),
      ),
    ).toMatchObject({
      reportAccount: 'work',
      outputDir: '/srv/out',
      outputDirSource: 'config',
      budgetAlertPercent: 75,
    });
  });

  it.each([
    [
      'a DM',
      { reportChannel: 'D0DM' },
      'skillReview.outputDir is required: the report goes to a DM, which has no homeDir',
    ],
    [
      'a channel without a homeDir',
      { reportChannel: 'C0OTHER' },
      'skillReview.outputDir is required: the report channel C0OTHER has no slack.channels.C0OTHER.homeDir',
    ],
    [
      'an outputDir not absolute on this host',
      { outputDir: 'D:/out' },
      'skillReview.outputDir must be absolute on this host: D:/out',
    ],
    [
      'an account the gateway lacks',
      { reportAccount: 'typo' },
      'skillReview.reportAccount: "typo" is not a gateway Slack account (gateway Slack accounts: default, work)',
    ],
  ])('returns the problem for %s', (_case, over, problem) => {
    expect(resolveSettings(block(over), deps())).toEqual({ problem });
  });

  it("returns the problem when the channel's homeDir is not absolute on this host", () => {
    expect(
      resolveSettings(block(), deps({ channelHomeDir: () => 'J:/review' })),
    ).toEqual({
      problem:
        'slack.channels.C0REVIEW.homeDir must be absolute on this host: J:/review',
    });
  });

  it('checks the account before reading the channel', () => {
    const channelHomeDir = vi.fn<SettingsDeps['channelHomeDir']>();
    const settings = resolveSettings(
      block(),
      deps({
        channelHomeDir,
        slackAccounts: () => {
          throw new Error('no openclaw.json');
        },
      }),
    );
    expect(settings).toEqual({
      problem:
        "skillReview names Slack accounts, but the gateway's could not be read: no openclaw.json",
    });
    expect(channelHomeDir).not.toHaveBeenCalled();
  });
});
