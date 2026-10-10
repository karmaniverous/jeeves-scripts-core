import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findInOpenclawConfig,
  gatewayPort,
  gatewayToken,
  openclawConfigPaths,
  slackBotToken,
  slackBotTokens,
} from './openclaw-config.js';

let dir: string;
let primary: string;
let legacy: string;
let savedEnv: string | undefined;

const write = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === 'string' ? value : JSON.stringify(value),
  );
};

beforeEach(() => {
  savedEnv = process.env.CLAWDBOT_GATEWAY_TOKEN;
  delete process.env.CLAWDBOT_GATEWAY_TOKEN;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-config-'));
  [primary, legacy] = openclawConfigPaths(dir) as [string, string];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.CLAWDBOT_GATEWAY_TOKEN;
  else process.env.CLAWDBOT_GATEWAY_TOKEN = savedEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('openclawConfigPaths', () => {
  it('searches openclaw.json, then the legacy clawdbot.json, under the home dir', () => {
    expect(openclawConfigPaths('/h')).toEqual([
      path.join('/h', '.openclaw', 'openclaw.json'),
      path.join('/h', '.clawdbot', 'clawdbot.json'),
    ]);
  });
});

describe('findInOpenclawConfig', () => {
  it('skips missing, unparseable and invalid files and returns the first defined pick', () => {
    write(primary, '{ not json');
    write(legacy, { gateway: { auth: { token: 'legacy' } } });
    expect(
      findInOpenclawConfig(
        (c) => c.gateway?.auth?.token,
        [path.join(dir, 'missing.json'), primary, legacy],
      ),
    ).toBe('legacy');
  });

  it('skips a file whose known fields have the wrong type', () => {
    write(primary, { gateway: { auth: { token: 42 } } });
    expect(
      findInOpenclawConfig((c) => c.gateway?.auth?.token, [primary]),
    ).toBeUndefined();
  });
});

describe('gatewayToken', () => {
  it('prefers a non-empty CLAWDBOT_GATEWAY_TOKEN', () => {
    write(primary, { gateway: { auth: { token: 'file' } } });
    process.env.CLAWDBOT_GATEWAY_TOKEN = 'env';
    expect(gatewayToken([primary])).toBe('env');
  });

  it('reads gateway.auth.token when the env var is empty or unset', () => {
    write(primary, { gateway: { auth: { token: 'file' } } });
    process.env.CLAWDBOT_GATEWAY_TOKEN = '';
    expect(gatewayToken([primary])).toBe('file');
  });

  it('returns null when nothing holds a token', () => {
    write(primary, { channels: {} });
    expect(gatewayToken([primary, legacy])).toBeNull();
  });
});

describe('slackBotTokens / slackBotToken', () => {
  it('reads per-account tokens, ignoring the flat token', () => {
    write(primary, {
      channels: {
        slack: {
          botToken: 'flat',
          accounts: { default: { botToken: 'a' }, work: { botToken: 'b' } },
        },
      },
    });
    expect(slackBotTokens([primary])).toEqual({ default: 'a', work: 'b' });
    expect(slackBotToken('work', [primary])).toBe('b');
  });

  it('falls back to the flat token as the default account', () => {
    write(primary, { channels: { slack: { botToken: 'flat' } } });
    expect(slackBotToken(undefined, [primary])).toBe('flat');
  });

  it('uses the first file that has any Slack token', () => {
    write(primary, { channels: {} });
    write(legacy, { channels: { slack: { botToken: 'old' } } });
    expect(slackBotTokens([primary, legacy])).toEqual({ default: 'old' });
  });

  it('throws when no file has a Slack token, or the account has none', () => {
    expect(() => slackBotTokens([primary])).toThrow(
      'No Slack bot token found in OpenClaw config',
    );
    write(primary, { channels: { slack: { botToken: 'flat' } } });
    expect(() => slackBotToken('work', [primary])).toThrow(
      'No Slack bot token for account "work"',
    );
  });
});

describe('gatewayPort', () => {
  it('reads gateway.port from the OpenClaw config', () => {
    write(primary, { gateway: { port: 4321 } });
    expect(gatewayPort([primary, legacy])).toBe(4321);
  });

  it("falls back to OpenClaw's default when no file sets it", () => {
    write(primary, { gateway: { auth: { token: 't' } } });
    expect(gatewayPort([primary, legacy])).toBe(18789);
  });
});
