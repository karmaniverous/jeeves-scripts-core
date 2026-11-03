/**
 * Tests for the `skillReview` block (spec 2.11): optional, every default,
 * every key's type and bounds, unknown keys refused, the report directory
 * rule (required unless the report channel has a `homeDir`, checked on
 * the whole config), the posting account checked against the gateway's,
 * and the exported schema left free of refinements (`.pick()`/`.omit()`
 * work). A present but invalid block is a `config check` problem
 * (Decision 76); an absent one is valid.
 */

import { describe, expect, it } from 'vitest';

import { configObjectSchema, configSchema } from './schema.js';
import {
  DEFAULT_BUDGET_ALERT_PERCENT,
  skillReviewAccountProblem,
  skillReviewSchema,
} from './skill-review-schema.js';

const REQUIRED = {
  reportChannel: 'C0REVIEW',
  timezone: 'America/Chicago',
  serverKey: 'skill-review-report',
};
const VALID = { ...REQUIRED, outputDir: '/srv/review' };

/** The issues of a whole config, as `path: message`. */
const issues = (config: Record<string, unknown>): string[] => {
  const parsed = configSchema.safeParse({
    instance: { name: 'test', baseDir: '/base' },
    ...config,
  });
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('skillReview', () => {
  it('is optional', () => {
    expect(issues({})).toEqual([]);
    expect(
      configObjectSchema.parse({ instance: { name: 't', baseDir: '/b' } }),
    ).not.toHaveProperty('skillReview');
  });

  it('applies every default', () => {
    expect(skillReviewSchema.parse(VALID)).toEqual({
      ...VALID,
      reportAccount: 'default',
      budgetAlertPercent: 90,
    });
    expect(DEFAULT_BUDGET_ALERT_PERCENT).toBe(90);
  });

  it.each([1, 90, 100])('accepts budgetAlertPercent %j', (percent) => {
    expect(
      issues({ skillReview: { ...VALID, budgetAlertPercent: percent } }),
    ).toEqual([]);
  });

  it.each([
    [{ budgetAlertPercent: 0 }, 'skillReview.budgetAlertPercent'],
    [{ budgetAlertPercent: 101 }, 'skillReview.budgetAlertPercent'],
    [{ budgetAlertPercent: 90.5 }, 'skillReview.budgetAlertPercent'],
    [{ budgetAlertPercent: '90' }, 'skillReview.budgetAlertPercent'],
    [{ reportChannel: undefined }, 'skillReview.reportChannel'],
    [
      { reportChannel: 'U0BOSS' },
      'reportChannel must be a Slack conversation id',
    ],
    [
      { reportChannel: '#general' },
      'reportChannel must be a Slack conversation id',
    ],
    [{ reportChannel: 'C0' }, 'reportChannel must be a Slack conversation id'],
    [{ reportChannel: 7 }, 'skillReview.reportChannel'],
    [{ reportAccount: ' ' }, 'skillReview.reportAccount'],
    [{ reportAccount: 3 }, 'skillReview.reportAccount'],
    [{ timezone: undefined }, 'skillReview.timezone'],
    [{ timezone: 'Mars/Olympus' }, 'timezone must be an IANA time zone'],
    [{ serverKey: undefined }, 'skillReview.serverKey'],
    [{ serverKey: ' ' }, 'skillReview.serverKey'],
    [{ outputDir: 'reports' }, 'outputDir must be an absolute path'],
    [{ outputDir: '' }, 'skillReview.outputDir'],
    [{ slackChannel: 'C0REVIEW' }, 'Unrecognized key'],
  ])('refuses %j', (over, problem) => {
    expect(issues({ skillReview: { ...VALID, ...over } }).join('\n')).toContain(
      problem,
    );
  });

  describe('report directory', () => {
    it('is required for a DM', () => {
      expect(
        issues({ skillReview: { ...REQUIRED, reportChannel: 'D0DM' } }),
      ).toEqual([
        'skillReview.outputDir: skillReview.outputDir is required: the report goes to a DM, which has no homeDir',
      ]);
    });

    it('is required for a channel with no homeDir', () => {
      expect(
        issues({
          slack: { channels: { C0REVIEW: { project: 'x' } } },
          skillReview: REQUIRED,
        }),
      ).toEqual([
        'skillReview.outputDir: skillReview.outputDir is required: the report channel C0REVIEW has no slack.channels.C0REVIEW.homeDir',
      ]);
    });

    it.each(['C0REVIEW', 'G0REVIEW'])("defaults to %s's homeDir", (id) => {
      expect(
        issues({
          slack: { channels: { [id]: { homeDir: '/srv/review' } } },
          skillReview: { ...REQUIRED, reportChannel: id },
        }),
      ).toEqual([]);
    });

    it('is accepted when set, whatever the target', () => {
      expect(
        issues({ skillReview: { ...VALID, reportChannel: 'D0DM' } }),
      ).toEqual([]);
    });

    it('is checked beside the slack.channelMeta rule, each on its own path', () => {
      expect(
        issues({
          slack: { channelMeta: { timezone: 'UTC', serverKey: 's' } },
          skillReview: { ...REQUIRED, reportChannel: 'D0DM' },
        }).map((i) => i.split(':')[0]),
      ).toEqual(['slack.channelMeta.outputDir', 'skillReview.outputDir']);
    });
  });

  describe('posting account', () => {
    it("is checked against the gateway's accounts, the default included", () => {
      expect(
        skillReviewAccountProblem({ reportAccount: 'default' }, () => ['work']),
      ).toBe(
        'skillReview.reportAccount: "default" is not a gateway Slack account (gateway Slack accounts: work)',
      );
      expect(
        skillReviewAccountProblem({ reportAccount: 'work' }, () => ['work']),
      ).toBeUndefined();
    });
  });

  it('leaves the exported schemas free of refinements: pick and omit work', () => {
    expect(
      Object.keys(skillReviewSchema.pick({ timezone: true }).shape),
    ).toEqual(['timezone']);
    expect(
      Object.keys(configObjectSchema.omit({ skillReview: true }).shape),
    ).not.toContain('skillReview');
  });
});
