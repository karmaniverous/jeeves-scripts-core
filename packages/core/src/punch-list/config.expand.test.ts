/**
 * `{npmGlobal}` and `{home}` expansion: npm's global prefix (environment,
 * `npm prefix -g`, built-in default) and the per-platform module directory.
 */

import { homedir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import {
  expandPath,
  liveNpmPrefixEnv,
  npmGlobalPrefix,
  type NpmPrefixEnv,
} from './config.js';

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

  it('asks the real npm when no prefix is in the environment', () => {
    // `npm test` sets npm_config_prefix; clear it to reach `npm prefix -g`.
    const live = liveNpmPrefixEnv();
    const printed = live.npmPrefix().trim();
    expect(printed).not.toBe('');
    expect(npmGlobalPrefix({ ...live, env: {} })).toBe(printed);
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
