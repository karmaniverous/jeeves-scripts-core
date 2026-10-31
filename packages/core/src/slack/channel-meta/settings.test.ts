/**
 * Tests for the runnable's settings from a validated `slack.channelMeta`
 * block: the block's defaults, every key carried over, host-style
 * absolute paths (win32 and posix) and a readable problem (never a
 * throw) for a directory that is not absolute on this host. The schema's
 * own checks are `config/slack-channel-meta-schema.test.ts`; the report
 * target and directory are `settings-report.test.ts`.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SWEEP_PATTERNS } from '../../config/slack-channel-meta-schema.js';
import {
  BASE,
  blockOf,
  problemOf,
  REQUIRED,
  resolveWith as resolve,
  settingsDeps,
} from './fakes.test-helper.js';
import { isUserTarget, resolveSettings } from './settings.js';

const WITH_DIR = { ...BASE, outputDir: 'C:/out' };

describe('resolveSettings', () => {
  it('takes the required keys and the block defaults', () => {
    expect(resolve(WITH_DIR)).toEqual({
      reportChannel: 'U0OWNER',
      reportChannelSource: 'config',
      outputDir: 'C:/out',
      outputDirSource: 'config',
      timeZone: 'UTC',
      serverKeyName: 'scripts',
      descriptionMaxChars: 250,
      topicMaxChars: 160,
      activityDays: 7,
      maxChannels: 20,
      exclude: new Set(),
      updateDescriptions: true,
      updateTopics: true,
      pathRoots: { roots: {}, host: path.win32 },
      sweepPatterns: DEFAULT_SWEEP_PATTERNS.map((p) => new RegExp(p, 'i')),
    });
  });

  it('carries every key over', () => {
    const s = resolve({
      ...BASE,
      reportChannel: 'C0REPORT',
      reportAccount: 'work',
      reportTextAccounts: ['work', 'other'],
      outputDir: 'D:\\reports',
      timezone: 'Asia/Makassar',
      descriptionMaxChars: 200,
      topicMaxChars: 250,
      activityDays: 3,
      maxChannels: 5,
      excludeChannels: ['C1', 'C2'],
      updateDescriptions: false,
      updateTopics: true,
      pathRoots: { J: 'J:/', srv: 'S:\\data' },
      relativeRoot: 'J:/base',
      sweepPatterns: ['^x$'],
    });
    expect(s).toEqual({
      reportChannel: 'C0REPORT',
      reportChannelSource: 'config',
      reportAccount: 'work',
      reportTextAccounts: ['work', 'other'],
      outputDir: 'D:\\reports',
      outputDirSource: 'config',
      timeZone: 'Asia/Makassar',
      serverKeyName: 'scripts',
      descriptionMaxChars: 200,
      topicMaxChars: 250,
      activityDays: 3,
      maxChannels: 5,
      exclude: new Set(['C1', 'C2']),
      updateDescriptions: false,
      updateTopics: true,
      pathRoots: {
        roots: { j: 'J:/', srv: 'S:\\data' },
        relativeRoot: 'J:/base',
        host: path.win32,
      },
      sweepPatterns: [/^x$/i],
    });
    expect('sweepPatterns' in s && s.sweepPatterns[0]?.test('X')).toBe(true);
  });

  describe('POSIX host', () => {
    it('takes POSIX roots and directories', () => {
      const s = resolve(
        {
          ...BASE,
          outputDir: '/opt/jeeves/admin/reports',
          pathRoots: { j: '/opt/jeeves/' },
          relativeRoot: '/opt/jeeves',
        },
        { host: path.posix },
      );
      expect(s).toMatchObject({
        outputDir: '/opt/jeeves/admin/reports',
        pathRoots: {
          roots: { j: '/opt/jeeves/' },
          relativeRoot: '/opt/jeeves',
          host: path.posix,
        },
      });
    });

    it('rejects a drive root', () => {
      expect(
        problemOf(
          resolve(
            { ...BASE, outputDir: '/out', pathRoots: { j: 'J:/' } },
            { host: path.posix },
          ),
        ),
      ).toBe(
        'slack.channelMeta.pathRoots.j must be absolute on this host: J:/',
      );
    });
  });

  it.each([
    [
      { pathRoots: { j: 'J:/a/../b' } },
      'slack.channelMeta.pathRoots.j',
      'J:/a/../b',
    ],
    [{ relativeRoot: '/srv' }, 'slack.channelMeta.relativeRoot', '/srv'],
    [{ outputDir: '/srv/out' }, 'slack.channelMeta.outputDir', '/srv/out'],
  ])(
    'names a directory not absolute on a Windows host: %j',
    (over, key, dir) => {
      expect(problemOf(resolve({ ...WITH_DIR, ...over }))).toBe(
        `${key} must be absolute on this host: ${dir}`,
      );
    },
  );

  it('rethrows a reader failure that is not a settings problem', () => {
    const boom = new Error('boom');
    expect(() =>
      resolveSettings(
        blockOf({ ...REQUIRED, reportChannel: 'C0REPORT' }),
        settingsDeps({
          channelHomeDir: () => {
            throw boom;
          },
        }),
      ),
    ).toThrow(boom);
  });

  it.each([
    ['U0AB', true],
    ['W0AB', true],
    ['C0AB', false],
    ['D0AB', false],
  ])('isUserTarget(%s) is %s', (id, user) => {
    expect(isUserTarget(id)).toBe(user);
  });
});
