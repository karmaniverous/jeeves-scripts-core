/**
 * Tests for `slack.channels` (schema and getChannelConfig), the Slack
 * cache files, and the watcher map helpers, against a temp instance
 * config whose stateDir is a temp dir.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../../config/loader.js';
import { slackConfigSchema } from '../../config/slack-schema.js';
import { channelConfigs, getChannelConfig } from './channel-config.js';
import {
  findInstanceConfig,
  resolveSlackChannelMeta,
  resolveSlackUserEmails,
} from './map-helpers.js';
import {
  cacheWrittenAt,
  channelCacheFile,
  loadChannelCache,
  loadUserCache,
  saveChannelCache,
  saveUserCache,
  slackCacheDir,
  userCacheFile,
  userNames,
} from './slack-cache.js';

let dir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-config-'));
  savedEnv = process.env[CONFIG_PATH_ENV];
  const configPath = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 't', baseDir: dir },
      slack: {
        channels: {
          C0123456789: { project: 'website', homeDir: 'D:/content/x' },
          C2: { project: 'other' },
        },
      },
    }),
  );
  process.env[CONFIG_PATH_ENV] = configPath;
  resetConfig();
});

afterEach(() => {
  process.env[CONFIG_PATH_ENV] = savedEnv;
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('slackConfigSchema', () => {
  it('defaults to no channels', () => {
    expect(slackConfigSchema.parse({})).toEqual({ channels: {} });
  });

  it.each(['D:/content/x', 'D:\\content\\x', '/srv/x', '\\\\host\\share'])(
    'accepts the absolute homeDir %s',
    (homeDir) => {
      expect(
        slackConfigSchema.safeParse({ channels: { C1: { homeDir } } }).success,
      ).toBe(true);
    },
  );

  it.each(['domains/x', './x', ''])('rejects the homeDir %j', (homeDir) => {
    expect(
      slackConfigSchema.safeParse({ channels: { C1: { homeDir } } }).success,
    ).toBe(false);
  });

  it('rejects unknown channel keys and ids that are not channel ids', () => {
    expect(
      slackConfigSchema.safeParse({ channels: { C1: { name: 'x' } } }).success,
    ).toBe(false);
    expect(
      slackConfigSchema.safeParse({ channels: { general: {} } }).success,
    ).toBe(false);
  });
});

describe('getChannelConfig', () => {
  it("returns a configured channel's project and home dir", () => {
    expect(getChannelConfig('C0123456789')).toEqual({
      project: 'website',
      homeDir: 'D:/content/x',
    });
    expect(getChannelConfig('C2')).toEqual({ project: 'other' });
    expect(Object.keys(channelConfigs())).toEqual(['C0123456789', 'C2']);
  });

  it('returns undefined for a channel without an entry', () => {
    expect(getChannelConfig('C404')).toBeUndefined();
    expect(getChannelConfig('constructor')).toBeUndefined();
  });
});

describe('slack-cache', () => {
  it('lives in {stateDir}/slack', () => {
    expect(slackCacheDir()).toBe(path.join(dir, 'state', 'slack'));
    expect(channelCacheFile()).toBe(
      path.join(dir, 'state', 'slack', 'channels.json'),
    );
    expect(userCacheFile()).toBe(
      path.join(dir, 'state', 'slack', 'users.json'),
    );
  });

  it('round-trips channels and users, creating the directory', () => {
    expect(loadChannelCache()).toEqual({});
    expect(cacheWrittenAt(userCacheFile())).toBe(0);
    saveChannelCache({ C1: { name: 'general', type: 'channel' } });
    saveUserCache({
      U1: { name: 'ann', alias: 'Ann Bee', emails: ['a@x'], is_bot: false },
      U2: { name: 'bot', emails: [], is_bot: true },
    });
    expect(loadChannelCache()).toEqual({
      C1: { name: 'general', type: 'channel' },
    });
    expect(userNames(loadUserCache())).toEqual({ U1: 'Ann Bee', U2: 'bot' });
    expect(cacheWrittenAt(userCacheFile())).toBeGreaterThan(0);
  });

  it('treats an unreadable cache as empty (it is rebuilt from Slack)', () => {
    fs.mkdirSync(slackCacheDir(), { recursive: true });
    fs.writeFileSync(userCacheFile(), '{bad');
    fs.writeFileSync(channelCacheFile(), '{"C1":{"name":1}}');
    expect(loadUserCache()).toEqual({});
    expect(loadChannelCache()).toEqual({});
  });
});

describe('map-helpers', () => {
  it('resolves user emails from the user cache, re-reading it when it changes', () => {
    expect(resolveSlackUserEmails(['U1'])).toEqual([]);
    saveUserCache({
      U1: { name: 'ann', emails: ['a@x'], is_bot: false },
      U2: { name: 'bob', emails: ['b@x', 'b2@x'], is_bot: false },
    });
    // Bump the mtime so the change is visible even within one clock tick.
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(userCacheFile(), later, later);
    expect(resolveSlackUserEmails(['U1', 'U2', 'U9'])).toEqual([
      'a@x',
      'b@x',
      'b2@x',
    ]);
    expect(resolveSlackUserEmails('U1')).toEqual(['a@x']);
    expect(resolveSlackUserEmails(null)).toEqual([]);
  });

  it('returns the channel config as channel metadata', () => {
    expect(resolveSlackChannelMeta('C2')).toEqual({ project: 'other' });
    expect(resolveSlackChannelMeta('C404')).toEqual({});
    expect(resolveSlackChannelMeta(42)).toEqual({});
  });

  it('finds the instance config above a directory', () => {
    const nested = path.join(dir, 'node_modules', 'pkg', 'dist');
    fs.mkdirSync(nested, { recursive: true });
    expect(findInstanceConfig(nested)).toBe(
      path.join(dir, 'jeeves-scripts.json'),
    );
    expect(findInstanceConfig(os.tmpdir())).toBeUndefined();
  });
});
