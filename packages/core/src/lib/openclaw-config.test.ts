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
  it('skips a missing file and returns the first defined pick', () => {
    write(legacy, { gateway: { auth: { token: 'legacy' } } });
    expect(
      findInOpenclawConfig(
        (c) => c.gateway?.auth?.token,
        [path.join(dir, 'missing.json'), primary, legacy],
      ),
    ).toBe('legacy');
  });

  it('reads JSON5: comments, unquoted keys and trailing commas (#42)', () => {
    write(
      primary,
      '// OpenClaw config\n{ gateway: { port: 19001, auth: { token: "t", }, }, }',
    );
    expect(gatewayPort([primary])).toBe(19001);
    expect(gatewayToken([primary])).toBe('t');
  });

  it.each([
    [
      'not JSON5',
      '{ not json',
      /Invalid JSON5 in OpenClaw config .*openclaw\.json/,
    ],
    [
      'a known field of the wrong type',
      { gateway: { auth: { token: 42 } } },
      /Invalid OpenClaw config .*openclaw\.json/,
    ],
  ])('throws, naming the file, on %s', (_name, value, message) => {
    write(primary, value);
    write(legacy, { gateway: { auth: { token: 'legacy' } } });
    expect(() =>
      findInOpenclawConfig((c) => c.gateway?.auth?.token, [primary, legacy]),
    ).toThrow(message);
  });

  it('throws, naming the file, when it exists but cannot be read', () => {
    fs.mkdirSync(primary, { recursive: true });
    expect(() => gatewayPort([primary])).toThrow(
      /Cannot read OpenClaw config .*openclaw\.json/,
    );
  });

  it.each([1, 65535])('accepts gateway.port %d', (port) => {
    write(primary, { gateway: { port } });
    expect(gatewayPort([primary])).toBe(port);
  });

  it.each([0, 65536, 1.5, '19001'])('rejects gateway.port %j', (port) => {
    write(primary, { gateway: { port } });
    expect(() => gatewayPort([primary])).toThrow(/Invalid OpenClaw config/);
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

describe('SecretRefs in token fields (#61 review)', () => {
  const ref = { source: 'env', provider: 'default', id: 'SLACK_BOT_TOKEN' };

  it('reads the rest of a config whose tokens are SecretRefs', () => {
    write(primary, {
      gateway: { port: 19001, auth: { token: ref } },
      channels: { slack: { botToken: ref } },
    });
    expect(gatewayPort([primary])).toBe(19001);
    expect(gatewayToken([primary])).toBeNull();
  });

  it('skips a SecretRef bot token and keeps the plain ones', () => {
    write(primary, {
      channels: {
        slack: {
          accounts: { a: { botToken: ref }, b: { botToken: 'xoxb-b' } },
        },
      },
    });
    expect(slackBotTokens([primary])).toEqual({ b: 'xoxb-b' });
  });

  it('still rejects a token that is neither a string nor an object', () => {
    write(primary, { gateway: { auth: { token: 42 } } });
    expect(() => gatewayPort([primary])).toThrow(/Invalid OpenClaw config/);
  });
});

describe('env references in token fields (#61 second review)', () => {
  const vars = ['OC_TEST_TOKEN', 'OC_TEST_MISSING'];
  afterEach(() => {
    for (const v of vars) Reflect.deleteProperty(process.env, v);
  });

  it('resolves ${VAR} and a whole-string $VAR from the environment', () => {
    process.env.OC_TEST_TOKEN = 'xoxb-env';
    write(primary, {
      gateway: { auth: { token: 'Bearer-${OC_TEST_TOKEN}' } },
      channels: { slack: { botToken: '$OC_TEST_TOKEN' } },
    });
    expect(gatewayToken([primary])).toBe('Bearer-xoxb-env');
    expect(slackBotTokens([primary])).toEqual({ default: 'xoxb-env' });
  });

  it('treats a reference to a missing variable as unset, and $${VAR} as a literal', () => {
    write(primary, {
      gateway: { auth: { token: '${OC_TEST_MISSING}' } },
      channels: { slack: { botToken: 'lit-$${OC_TEST_TOKEN}' } },
    });
    expect(gatewayToken([primary])).toBeNull();
    expect(slackBotTokens([primary])).toEqual({
      default: 'lit-${OC_TEST_TOKEN}',
    });
  });

  it('reads a SecretRef with any source as unset, and says so when no token is left', () => {
    write(primary, {
      channels: { slack: { botToken: { source: 'vault', id: 'x' } } },
    });
    expect(() => slackBotTokens([primary])).toThrow(/not SecretRef objects/);
  });
});
