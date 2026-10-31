/**
 * Tests for where the report goes: the summary target (`reportChannel`,
 * else the OpenClaw command owner's DM; neither is a problem naming both)
 * and the report directory (`outputDir`, else the report channel's
 * `homeDir`; a DM's homeDir is never looked up; absolute on the host,
 * win32 or posix).
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BASE,
  problemOf,
  REQUIRED,
  resolveWith as resolve,
} from './fakes.test-helper.js';
import { isDmTarget } from './settings.js';

const WITH_DIR = { ...BASE, outputDir: 'C:/out' };

describe('resolveSettings: report', () => {
  describe('report target', () => {
    it('defaults to the OpenClaw owner when reportChannel is unset', () => {
      expect(
        resolve(
          { ...REQUIRED, outputDir: 'C:/out' },
          { slackOwner: () => 'U0BOSS' },
        ),
      ).toMatchObject({
        reportChannel: 'U0BOSS',
        reportChannelSource: 'owner',
      });
    });

    it('prefers reportChannel over the owner', () => {
      expect(resolve(WITH_DIR, { slackOwner: () => 'U0BOSS' })).toMatchObject({
        reportChannel: 'U0OWNER',
        reportChannelSource: 'config',
      });
    });

    it('names both sources when neither is available', () => {
      expect(problemOf(resolve({ ...REQUIRED, outputDir: 'C:/out' }))).toBe(
        'no report target: set slack.channelMeta.reportChannel (a Slack channel id, or a user id for their DM), or add a "slack:<user id>" entry to commands.ownerAllowFrom in the OpenClaw config',
      );
    });

    it.each(['C0AB', 'G0AB', 'D0AB', 'U0AB', 'W0AB'])('accepts %s', (id) => {
      expect(resolve({ ...WITH_DIR, reportChannel: id })).toHaveProperty(
        'reportChannel',
        id,
      );
    });
  });

  describe('report directory', () => {
    it.each(['C0ADMIN', 'G0ADMIN'])(
      "defaults to the report channel's homeDir (%s)",
      (id) => {
        expect(
          resolve(
            { ...REQUIRED, reportChannel: id },
            { channelHomeDir: (c) => (c === id ? 'J:/admin' : undefined) },
          ),
        ).toMatchObject({ outputDir: 'J:/admin', outputDirSource: 'homeDir' });
      },
    );

    it('prefers outputDir over the homeDir', () => {
      expect(
        resolve(
          { ...REQUIRED, reportChannel: 'C0ADMIN', outputDir: 'C:/out' },
          { channelHomeDir: () => 'J:/admin' },
        ),
      ).toMatchObject({ outputDir: 'C:/out', outputDirSource: 'config' });
    });

    it.each([
      ['an owner DM', {}, { slackOwner: () => 'U0BOSS' }],
      ['a user target', { reportChannel: 'W0USER' }, {}],
      ['a DM conversation', { reportChannel: 'D0DM' }, {}],
    ])(
      'is required for %s, whose homeDir is never looked up',
      (_c, over, deps) => {
        let asked = false;
        expect(
          problemOf(
            resolve(
              { ...REQUIRED, ...over },
              {
                ...deps,
                channelHomeDir: () => {
                  asked = true;
                  return 'J:/never';
                },
              },
            ),
          ),
        ).toBe(
          'no report directory: set slack.channelMeta.outputDir (the report goes to a DM, which has no homeDir)',
        );
        expect(asked).toBe(false);
      },
    );

    it('names a channel with no homeDir', () => {
      expect(problemOf(resolve({ ...REQUIRED, reportChannel: 'C0X' }))).toBe(
        'no report directory: set slack.channelMeta.outputDir (the report goes to C0X, which has no slack.channels.C0X.homeDir)',
      );
    });

    it.each([
      ['a POSIX dir on Windows', path.win32, '/srv/out'],
      ['a drive dir on POSIX', path.posix, 'J:/out'],
    ])('rejects %s', (_, host, dir) => {
      expect(problemOf(resolve({ ...BASE, outputDir: dir }, { host }))).toBe(
        `slack.channelMeta.outputDir must be absolute on this host: ${dir}`,
      );
    });

    it('says when a homeDir is not absolute on this host', () => {
      expect(
        problemOf(
          resolve(
            { ...REQUIRED, reportChannel: 'C0ADMIN' },
            { channelHomeDir: () => 'J:/admin', host: path.posix },
          ),
        ),
      ).toBe(
        'slack.channels.C0ADMIN.homeDir must be absolute on this host: J:/admin',
      );
    });
  });

  describe('report text accounts', () => {
    it("is unset by default (the report target's account decides)", () => {
      expect(resolve(WITH_DIR)).not.toHaveProperty('reportTextAccounts');
      expect(resolve(WITH_DIR)).not.toHaveProperty('reportAccount');
    });

    it.each([[['vc', 'default']], [[]]])('carries %j over', (accounts) => {
      expect(
        resolve({ ...WITH_DIR, reportTextAccounts: accounts }),
      ).toHaveProperty('reportTextAccounts', accounts);
    });
  });

  it.each([
    ['D0AB', true],
    ['C0AB', false],
    ['U0AB', false],
  ])('isDmTarget(%s) is %s', (id, dm) => {
    expect(isDmTarget(id)).toBe(dm);
  });
});
