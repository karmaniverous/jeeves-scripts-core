/**
 * The `punchList` block: its schema (required fields, validation, no
 * shipped install map), the derived defaults, and the path helpers.
 */

import { homedir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { punchListSchema } from '../config/punch-list-schema.js';
import { configSchema } from '../config/schema.js';
import {
  DEFAULT_INPUT_DIRS,
  derivePunchList,
  expandPath,
  npmGlobalPrefix,
  type NpmPrefixEnv,
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
      'slack.channel must be a Slack conversation id (C…, G… or D…)',
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
    ...['rel', '{homes}/x', '{home}x', 'x/{home}', '{stateDir}/x'].map(
      (root) => [
        { inputRoots: [root] },
        'inputRoots entry must be an absolute path, or start with {home} or {npmGlobal}',
      ],
    ),
    [{ specPath: 'rel.md' }, 'specPath must be an absolute path'],
    [{ lockFile: 'x' }, 'lockFile must be an absolute path'],
  ])('rejects %j', (over, message) => {
    const result = punchListSchema.safeParse({ ...minimal, ...over });
    expect(result.error?.issues.map((i) => i.message)).toEqual([message]);
  });

  it('accepts absolute and {home} / {npmGlobal} input roots', () => {
    const inputRoots = [
      '/abs',
      'D:\\abs',
      '{home}',
      '{home}/notes',
      '{npmGlobal}\\pkg',
    ];
    expect(
      punchListSchema.parse({ ...minimal, inputRoots }).inputRoots,
    ).toEqual(inputRoots);
  });

  it('accepts conversation ids and channel: targets', () => {
    for (const channel of [
      'C000PUNCH01',
      'G000PUNCH01',
      'D000PUNCH01',
      'channel:C000PUNCH01',
    ])
      expect(
        punchListSchema.parse({ ...minimal, slack: { channel } }).slack.channel,
      ).toBe(channel);
  });

  it.each(['U000PERSON1', 'W000PERSON1', 'user:U000PERSON1'])(
    'refuses the user id %s: chat.update needs a conversation id',
    (channel) => {
      const result = punchListSchema.safeParse({
        ...minimal,
        slack: { channel },
      });
      expect(result.error?.issues.map((i) => i.message)).toEqual([
        "slack.channel must be a conversation id, not a user id: use the DM's D… id (chat.update of the pinned message needs it)",
      ]);
    },
  );
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

  it('expands {home} in configured input roots, as the harvester and its task see them', () => {
    const derived = derivePunchList(
      config({
        ...minimal,
        inputRoots: ['{home}/notes', path.join(base, 'x')],
      }),
    );
    expect(derived?.inputRoots).toEqual([
      `${homedir()}/notes`,
      path.join(base, 'x'),
    ]);
  });

  it('keeps configured paths and strips a target prefix from the channel', () => {
    const own = path.join(base, 'own');
    const derived = derivePunchList(
      config({
        ...minimal,
        slack: { channel: 'channel:D000PUNCH01', pinnedTs: '1.2' },
        lockFile: path.join(own, 'l'),
        pendingFile: path.join(own, 'p'),
        cursorFile: path.join(own, 'c'),
        inboxDir: path.join(own, 'i'),
        inputRoots: [own],
      }),
    );
    expect(derived).toMatchObject({
      slack: { channel: 'D000PUNCH01', account: 'default', pinnedTs: '1.2' },
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
      npmPrefix: () => '/n/v24',
      home: '/home/u',
      platform: 'linux' as const,
    };
    expect(expandPath('{npmGlobal}/@k/x/package.json', env)).toBe(
      '/n/v24/lib/node_modules/@k/x/package.json',
    );
    expect(expandPath('{home}/.openclaw/a', env)).toBe('/home/u/.openclaw/a');
  });

  it('expands {npmGlobal} to <prefix>\\node_modules on Windows', () => {
    const env = {
      npmPrefix: () => 'C:\\Users\\u\\AppData\\Roaming\\npm',
      home: 'C:\\Users\\u',
      platform: 'win32' as const,
    };
    expect(expandPath('{npmGlobal}', env)).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules',
    );
  });

  it('reads the npm prefix only for a {npmGlobal} pattern', () => {
    const npmPrefix = vi.fn(() => '/p');
    const env = { npmPrefix, home: '/h', platform: 'linux' as const };
    expect(expandPath('{home}/x', env)).toBe('/h/x');
    expect(npmPrefix).not.toHaveBeenCalled();
    expect(expandPath('{npmGlobal}/{home}', env)).toBe(
      '/p/lib/node_modules//h',
    );
    expect(npmPrefix).toHaveBeenCalledTimes(1);
  });

  it('defaults to this process', () => {
    expect(expandPath('plain')).toBe('plain');
    const prefix = npmGlobalPrefix();
    expect(expandPath('{npmGlobal}')).toBe(
      expandPath('{npmGlobal}', {
        npmPrefix: () => prefix,
        home: '',
        platform: process.platform,
      }),
    );
    expect(expandPath('{home}')).toBe(homedir());
  });
});

describe('npmGlobalPrefix', () => {
  const env = (over: Partial<NpmPrefixEnv> = {}): NpmPrefixEnv => ({
    env: {},
    execPath: '/n/v24/bin/node',
    platform: 'linux',
    npmPrefix: () => '/usr/local\n',
    ...over,
  });

  it('prefers npm_config_prefix, in either case', () => {
    const npmPrefix = vi.fn(() => '/unused');
    expect(
      npmGlobalPrefix(env({ env: { npm_config_prefix: '/cfg' }, npmPrefix })),
    ).toBe('/cfg');
    expect(
      npmGlobalPrefix(env({ env: { NPM_CONFIG_PREFIX: '/CFG' }, npmPrefix })),
    ).toBe('/CFG');
    expect(npmPrefix).not.toHaveBeenCalled();
  });

  it("uses npm's own answer, trimmed (the standard Windows installer's %APPDATA%\\npm)", () => {
    expect(npmGlobalPrefix(env())).toBe('/usr/local');
    expect(
      npmGlobalPrefix(
        env({
          platform: 'win32',
          execPath: 'C:\\Program Files\\nodejs\\node.exe',
          npmPrefix: () => 'C:\\Users\\u\\AppData\\Roaming\\npm\r\n',
        }),
      ),
    ).toBe('C:\\Users\\u\\AppData\\Roaming\\npm');
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('npm: not found');
      },
    ],
    ['prints nothing', () => '  \n'],
  ])("falls back to npm's built-in default when npm %s", (_, npmPrefix) => {
    expect(npmGlobalPrefix(env({ npmPrefix }))).toBe('/n/v24');
    expect(
      npmGlobalPrefix(
        env({ platform: 'win32', execPath: 'C:\\nvm\\node.exe', npmPrefix }),
      ),
    ).toBe('C:\\nvm');
  });
});
