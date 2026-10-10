/**
 * gatewayInvoke against a loopback HTTP server: the request it sends
 * (endpoint, bearer token, body, optional session key), and how it maps
 * responses to results and errors. The gateway address comes from
 * `integrations.gateway` in a temp config.
 */

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { gatewayInvoke } from './gateway-client.js';

interface Seen {
  url?: string;
  method?: string;
  auth?: string;
  body?: unknown;
}

let server: http.Server;
let dir: string;
let reply: { status: number; body: string } = { status: 200, body: '{}' };
const seen: Seen = {};
const saved = {
  config: process.env[CONFIG_PATH_ENV],
  token: process.env.CLAWDBOT_GATEWAY_TOKEN,
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => {
      seen.url = req.url;
      seen.method = req.method;
      seen.auth = req.headers.authorization;
      seen.body = JSON.parse(data) as unknown;
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-invoke-'));
  const configPath = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 't', baseDir: dir },
      integrations: { gateway: { host: '127.0.0.1', port } },
    }),
  );
  process.env[CONFIG_PATH_ENV] = configPath;
  process.env.CLAWDBOT_GATEWAY_TOKEN = 'test-token';
  resetConfig();
});

afterEach(() => {
  reply = { status: 200, body: '{}' };
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  process.env[CONFIG_PATH_ENV] = saved.config;
  if (saved.token === undefined) delete process.env.CLAWDBOT_GATEWAY_TOKEN;
  else process.env.CLAWDBOT_GATEWAY_TOKEN = saved.token;
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('gatewayInvoke', () => {
  it('POSTs the tool call to /tools/invoke with the bearer token and resolves result', async () => {
    reply = {
      status: 200,
      body: JSON.stringify({ ok: true, result: { a: 1 } }),
    };
    await expect(gatewayInvoke('sessions_list', { limit: 5 })).resolves.toEqual(
      {
        a: 1,
      },
    );
    expect(seen).toEqual({
      url: '/tools/invoke',
      method: 'POST',
      auth: 'Bearer test-token',
      body: { tool: 'sessions_list', args: { limit: 5 } },
    });
  });

  it('sends the session key when given', async () => {
    reply = { status: 200, body: JSON.stringify({ ok: true, result: {} }) };
    await gatewayInvoke('message', {}, { sessionKey: 'agent:main:x' });
    expect(seen.body).toEqual({
      tool: 'message',
      args: {},
      sessionKey: 'agent:main:x',
    });
  });

  it("rejects with the gateway's error message", async () => {
    reply = {
      status: 403,
      body: JSON.stringify({ ok: false, error: { message: 'tool denied' } }),
    };
    await expect(gatewayInvoke('exec', {})).rejects.toThrow('tool denied');
  });

  it('rejects a 200 whose body is not ok, with the raw body', async () => {
    reply = { status: 200, body: JSON.stringify({ ok: false }) };
    await expect(gatewayInvoke('x', {})).rejects.toThrow('{"ok":false}');
  });

  it('rejects a non-JSON body', async () => {
    reply = { status: 502, body: 'Bad Gateway' };
    await expect(gatewayInvoke('x', {})).rejects.toThrow(
      'Gateway invalid JSON: Bad Gateway',
    );
  });
});
