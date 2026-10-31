/**
 * The `punchList` block: its schema (required fields, validation, no
 * shipped install map), the derived defaults, and the path helpers.
 */

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { punchListSchema } from '../config/punch-list-schema.js';
import { configSchema } from '../config/schema.js';
import {
  DEFAULT_INPUT_DIRS,
  derivePunchList,
  expandPath,
  scannedRepos,
  slackChannelId,
} from './config.js';
import { testConfig } from './punch-list.test-helper.js';

const base = path.resolve('/base');
const minimal = {
  dir: path.join(base, 'content', 'punch-list'),
  timeZone: 'America/Chicago',
  slack: { channel: 'C000PUNCH01' },
  scriptsRepo: {
    repo: 'acme/jeeves-scripts-acme',
    clone: path.join(base, 'jeeves-scripts'),
  },
};

const config = (punchList: unknown, extra: object = {}) =>
  configSchema.parse({
    instance: { name: 'acme', baseDir: base },
    punchList,
    ...extra,
  });

describe('punchListSchema', () => {
  it('fills the defaults and ships no install map', () => {
    expect(punchListSchema.parse(minimal)).toEqual({
      ...minimal,
      retentionDays: 30,
      slack: { channel: 'C000PUNCH01', account: 'default' },
      installMap: {},
    });
  });

  it.each([
    ['dir', { dir: undefined }],
    ['timeZone', { timeZone: undefined }],
    ['slack', { slack: undefined }],
    ['scriptsRepo', { scriptsRepo: undefined }],
  ])('requires %s', (key, over) => {
    const result = punchListSchema.safeParse({ ...minimal, ...over });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([key]);
  });

  it.each([
    [{ dir: 'relative/dir' }, 'dir must be an absolute path'],
    [{ timeZone: 'Mars/Base' }, 'timeZone must be an IANA time zone'],
    [{ retentionDays: 0 }, 'Too small: expected number to be >0'],
    [
      { slack: { channel: '#punch-list' } },
      'slack.channel must be a Slack channel or user id',
    ],
    [
      { slack: { channel: 'C000PUNCH01', account: '' } },
      'Too small: expected string to have >=1 characters',
    ],
    [
      { scriptsRepo: { repo: 'nope', clone: minimal.scriptsRepo.clone } },
      'scriptsRepo.repo must be owner/name',
    ],
    [
      { scriptsRepo: { repo: 'a/b', clone: 'rel' } },
      'scriptsRepo.clone must be an absolute path',
    ],
    [{ installMap: { nope: [] } }, 'Invalid key in record'],
    [
      { installMap: { 'a/b': [{ component: 'svc', packageJson: '' }] } },
      'Too small: expected string to have >=1 characters',
    ],
    [{ inputRoots: [] }, 'Too small: expected array to have >=1 items'],
    [{ inputRoots: ['rel'] }, 'inputRoots entry must be an absolute path'],
    [{ specPath: 'rel.md' }, 'specPath must be an absolute path'],
    [{ lockFile: 'x' }, 'lockFile must be an absolute path'],
  ])('rejects %j', (over, message) => {
    const result = punchListSchema.safeParse({ ...minimal, ...over });
    expect(result.error?.issues.map((i) => i.message)).toEqual([message]);
  });

  it('accepts a user id and channel: / user: targets', () => {
    for (const channel of [
      'U000PERSON1',
      'channel:C000PUNCH01',
      'user:U000PERSON1',
    ])
      expect(
        punchListSchema.parse({ ...minimal, slack: { channel } }).slack.channel,
      ).toBe(channel);
  });
});

describe('derivePunchList', () => {
  it('is undefined with no block', () => {
    expect(derivePunchList(config(undefined))).toBeUndefined();
  });

  it('derives every default path from the state dir, default silo and config dir', () => {
    const state = path.join(base, 'state', 'punch-list');
    expect(derivePunchList(config(minimal))).toEqual({
      ...minimal,
      retentionDays: 30,
      slack: { channel: 'C000PUNCH01', account: 'default' },
      installMap: {},
      lockFile: path.join(state, 'punch-list.lock'),
      pendingFile: path.join(state, 'status-pending.json'),
      cursorFile: path.join(state, 'harvest-cursor.json'),
      inboxDir: path.join(state, 'inbox'),
      inputRoots: [
        ...DEFAULT_INPUT_DIRS.map((d) => path.join(base, 'content', d)),
        path.join(base, 'state', 'jeeves-watcher', 'issues.json'),
      ],
      serverConfig: path.join(base, 'config', 'jeeves-server', 'config.json'),
    });
    expect([...DEFAULT_INPUT_DIRS]).toEqual([
      'email',
      'slack',
      'meetings',
      'google-drive',
    ]);
  });

  it('roots the default inputs in the default silo base when one is set', () => {
    const silo = path.join(base, 'silo');
    const derived = derivePunchList(
      config(minimal, { siloRouting: { defaultBasePath: silo, silos: {} } }),
    );
    expect(derived?.inputRoots[0]).toBe(path.join(silo, 'email'));
  });

  it('keeps configured paths and strips a target prefix from the channel', () => {
    const own = path.join(base, 'own');
    const derived = derivePunchList(
      config({
        ...minimal,
        slack: { channel: 'user:U000PERSON1', pinnedTs: '1.2' },
        lockFile: path.join(own, 'l'),
        pendingFile: path.join(own, 'p'),
        cursorFile: path.join(own, 'c'),
        inboxDir: path.join(own, 'i'),
        inputRoots: [own],
      }),
    );
    expect(derived).toMatchObject({
      slack: { channel: 'U000PERSON1', account: 'default', pinnedTs: '1.2' },
      lockFile: path.join(own, 'l'),
      pendingFile: path.join(own, 'p'),
      cursorFile: path.join(own, 'c'),
      inboxDir: path.join(own, 'i'),
      inputRoots: [own],
    });
  });
});

describe('slackChannelId', () => {
  it.each([
    ['C000PUNCH01', 'C000PUNCH01'],
    ['channel:C000PUNCH01', 'C000PUNCH01'],
    ['user:U000PERSON1', 'U000PERSON1'],
  ])('%s → %s', (raw, id) => {
    expect(slackChannelId(raw)).toBe(id);
  });
});

describe('scannedRepos', () => {
  it('is the scripts repo, then every install-map repo', () => {
    expect(
      scannedRepos(testConfig({ installMap: { 'k/a': [], 'k/b': [] } })),
    ).toEqual(['acme/jeeves-scripts-acme', 'k/a', 'k/b']);
  });
});

describe('expandPath', () => {
  it('expands {npmGlobal} to <prefix>/lib/node_modules, and {home}', () => {
    const env = {
      execPath: '/n/v24/bin/node',
      home: '/home/u',
      platform: 'linux' as const,
    };
    expect(expandPath('{npmGlobal}/@k/x/package.json', env)).toBe(
      `${path.resolve('/n/v24/lib/node_modules')}/@k/x/package.json`,
    );
    expect(expandPath('{home}/.openclaw/a', env)).toBe('/home/u/.openclaw/a');
  });

  it('expands {npmGlobal} beside node.exe on Windows', () => {
    const env = {
      execPath: 'C:\\node\\node.exe',
      home: 'C:\\Users\\u',
      platform: 'win32' as const,
    };
    expect(expandPath('{npmGlobal}', env)).toBe(
      path.join('C:\\node', 'node_modules'),
    );
  });

  it('defaults to this process', () => {
    expect(expandPath('plain')).toBe('plain');
    expect(expandPath('{npmGlobal}')).toContain('node_modules');
  });
});
