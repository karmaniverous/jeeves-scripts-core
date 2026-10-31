/**
 * Tests for the `slack.channelMeta` block (spec 2.6): defaults, every
 * key's type and bounds, unknown keys refused, and the report directory
 * rule (required unless the report channel has a `homeDir`, checked on
 * the whole config), and the exported schemas left free of refinements
 * (`.pick()`/`.omit()` work). A present but invalid block is a
 * `config check` problem (Decision 76); an absent one is valid.
 */

import { describe, expect, it } from 'vitest';

import { configObjectSchema, configSchema } from './schema.js';
import {
  DEFAULT_SWEEP_PATTERNS,
  defaultReportDir,
  isChannelTarget,
  SLACK_TEXT_MAX,
  slackChannelMetaSchema,
} from './slack-channel-meta-schema.js';
import { slackConfigSchema } from './slack-schema.js';

const REQUIRED = { timezone: 'UTC', serverKey: 'scripts' };
const VALID = { ...REQUIRED, outputDir: '/srv/reports' };

/** The issues of a `slack` block in a whole config, as `path: message`
 * under `slack`. */
const issues = (slack: unknown): string[] => {
  const parsed = configSchema.safeParse({
    instance: { name: 'test', baseDir: '/base' },
    slack,
  });
  return parsed.success
    ? []
    : parsed.error.issues.map(
        (i) => `${i.path.slice(1).join('.')}: ${i.message}`,
      );
};

describe('slack.channelMeta', () => {
  it('is optional', () => {
    expect(slackConfigSchema.parse({})).not.toHaveProperty('channelMeta');
  });

  it('applies every default', () => {
    expect(slackChannelMetaSchema.parse(VALID)).toEqual({
      ...VALID,
      descriptionMaxChars: 250,
      topicMaxChars: 160,
      activityDays: 7,
      maxChannels: 20,
      excludeChannels: [],
      updateDescriptions: true,
      updateTopics: true,
      pathRoots: {},
      sweepPatterns: DEFAULT_SWEEP_PATTERNS,
    });
    expect(SLACK_TEXT_MAX).toBe(250);
  });

  it('matches a seed-meta home-directory post with the default patterns', () => {
    const patterns = DEFAULT_SWEEP_PATTERNS.map((p) => new RegExp(p, 'i'));
    const post = 'Created `j/x` and seeded meta. This is the home dir.';
    expect(patterns.every((p) => p.test(post))).toBe(true);
    expect(patterns.map((p) => p.test('the home directory'))).toEqual([
      false,
      true,
    ]);
    expect(patterns.map((p) => p.test('seeding meta here'))).toEqual([
      true,
      false,
    ]);
  });

  it.each([
    [{ serverKey: 'scripts' }, 'channelMeta.timezone'],
    [
      { ...REQUIRED, timezone: 'Mars/Olympus' },
      'timezone must be an IANA time zone',
    ],
    [{ timezone: 'UTC' }, 'channelMeta.serverKey'],
    [{ ...REQUIRED, serverKey: ' ' }, 'channelMeta.serverKey'],
    [
      { ...REQUIRED, reportChannel: '#general' },
      'reportChannel must be a Slack channel or user id',
    ],
    [{ ...REQUIRED, reportAccount: '' }, 'channelMeta.reportAccount'],
    [
      { ...REQUIRED, reportTextAccounts: [' '] },
      'channelMeta.reportTextAccounts.0',
    ],
    [
      { ...REQUIRED, outputDir: 'reports' },
      'outputDir must be an absolute path',
    ],
    [
      { ...REQUIRED, descriptionMaxChars: 251 },
      'channelMeta.descriptionMaxChars',
    ],
    [{ ...REQUIRED, topicMaxChars: 0 }, 'channelMeta.topicMaxChars'],
    [{ ...REQUIRED, activityDays: 2.5 }, 'channelMeta.activityDays'],
    [{ ...REQUIRED, activityDays: 91 }, 'channelMeta.activityDays'],
    [{ ...REQUIRED, maxChannels: 201 }, 'channelMeta.maxChannels'],
    [
      { ...REQUIRED, excludeChannels: ['general'] },
      'expected a Slack channel id',
    ],
    [{ ...REQUIRED, updateTopics: 'yes' }, 'channelMeta.updateTopics'],
    [
      { ...REQUIRED, pathRoots: { 'a/b': '/srv' } },
      'a pathRoots key is one path segment',
    ],
    [
      { ...REQUIRED, pathRoots: { j: 'relative' } },
      'a pathRoots directory must be an absolute path',
    ],
    [
      { ...REQUIRED, relativeRoot: 'domains' },
      'relativeRoot must be an absolute path',
    ],
    [{ ...REQUIRED, sweepPatterns: [] }, 'channelMeta.sweepPatterns'],
    [{ ...REQUIRED, sweepPatterns: ['a', ''] }, 'channelMeta.sweepPatterns.1'],
    [
      { ...REQUIRED, sweepPatterns: ['('] },
      'sweepPatterns entry is not a valid regular expression',
    ],
    [{ ...REQUIRED, refs: {} }, 'Unrecognized key'],
  ])('refuses %j', (block, problem) => {
    expect(
      issues({ channelMeta: { outputDir: '/srv/reports', ...block } }).join(
        '\n',
      ),
    ).toContain(problem);
  });

  describe('report directory', () => {
    const DM =
      'channelMeta.outputDir: slack.channelMeta.outputDir is required: the report goes to a DM, which has no homeDir';

    it.each([
      ['the owner DM (no reportChannel)', {}],
      ['a user', { reportChannel: 'U0BOSS' }],
      ['a DM conversation', { reportChannel: 'D0DM' }],
    ])('is required for %s', (_case, over) => {
      expect(issues({ channelMeta: { ...REQUIRED, ...over } })).toEqual([DM]);
    });

    it('is required for a channel with no homeDir', () => {
      expect(
        issues({
          channels: { C0ADMIN: { project: 'x' } },
          channelMeta: { ...REQUIRED, reportChannel: 'C0ADMIN' },
        }),
      ).toEqual([
        'channelMeta.outputDir: slack.channelMeta.outputDir is required: the report channel C0ADMIN has no slack.channels.C0ADMIN.homeDir',
      ]);
    });

    it('is not checked by the slack schema alone (the whole config checks it)', () => {
      expect(
        slackConfigSchema.safeParse({ channelMeta: REQUIRED }).success,
      ).toBe(true);
    });

    it('gives the run the report channel\u2019s homeDir', () => {
      expect(defaultReportDir('C0ADMIN', () => '/srv/admin')).toEqual({
        homeDir: '/srv/admin',
      });
    });

    it.each(['C0ADMIN', 'G0ADMIN'])("defaults to %s's homeDir", (id) => {
      expect(
        issues({
          channels: { [id]: { homeDir: '/srv/admin' } },
          channelMeta: { ...REQUIRED, reportChannel: id },
        }),
      ).toEqual([]);
    });

    it('is accepted when set, whatever the target', () => {
      expect(issues({ channelMeta: VALID })).toEqual([]);
    });
  });

  it('leaves the exported schemas free of refinements: pick and omit work', () => {
    expect(slackConfigSchema.pick({ channels: true }).parse({})).toEqual({
      channels: {},
    });
    expect(
      Object.keys(slackConfigSchema.omit({ channelMeta: true }).shape),
    ).not.toContain('channelMeta');
    expect(Object.keys(configObjectSchema.pick({ slack: true }).shape)).toEqual(
      ['slack'],
    );
    expect(
      Object.keys(slackChannelMetaSchema.pick({ timezone: true }).shape),
    ).toEqual(['timezone']);
  });

  it.each([
    ['C0AB', true],
    ['G0AB', true],
    ['D0AB', false],
    ['U0AB', false],
  ])('isChannelTarget(%s) is %s', (id, channel) => {
    expect(isChannelTarget(id)).toBe(channel);
  });
});
