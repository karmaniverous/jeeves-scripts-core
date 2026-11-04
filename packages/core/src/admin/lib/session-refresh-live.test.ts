/**
 * Tests for session refresh's live collaborators: the settings from a temp
 * config's job delta, the RPC waits, the per-agent read-only DB reader on
 * schema-23 fixtures (opened once, missing DB and unsupported schema
 * fail), the Slack client per account, and the doctor check over fakes
 * (the listed agents' DBs, never a hardcoded one).
 * Nothing here calls the gateway, Slack or a real agent DB.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GatewayRpcModule from '../../lib/gateway-rpc.js';
import type * as OpenclawConfigModule from '../../lib/openclaw-config.js';

const mocks = vi.hoisted(() => ({
  gatewayRpc: vi.fn(() => Promise.resolve({})),
  slackBotToken: vi.fn(() => 'xoxb-test'),
}));

vi.mock(
  '../../lib/gateway-rpc.js',
  async (importOriginal: () => Promise<typeof GatewayRpcModule>) => ({
    ...(await importOriginal()),
    gatewayRpc: mocks.gatewayRpc,
  }),
);
vi.mock(
  '../../lib/openclaw-config.js',
  async (importOriginal: () => Promise<typeof OpenclawConfigModule>) => ({
    ...(await importOriginal()),
    slackBotToken: mocks.slackBotToken,
  }),
);

import { useTempConfig } from '../../lib/temp-config.test-helper.js';
import { T10, usage } from './openclaw-db/openclaw-db.fixtures.js';
import { createV23Fixture } from './openclaw-db/v23.fixtures.js';
import {
  liveRpc,
  liveSettings,
  liveSlack,
  openUsageReader,
  READ_WAIT_MS,
  RESET_WAIT_MS,
  sessionRefreshDoctorCheck,
  type UsageReader,
} from './session-refresh-live.js';

useTempConfig({
  jobs: { 'admin-refresh-sessions': { idleMinutes: 90, excludedKeys: ['k'] } },
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-refresh-live-'));
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

/** An agent DB path under the temp state dir. */
const dbPathFor = (agentId: string) =>
  path.join(root, 'agents', agentId, 'agent', 'openclaw-agent.sqlite');

describe('liveSettings', () => {
  it("reads the job's delta from the loaded config", () => {
    const s = liveSettings();
    expect(s.idleMinutes).toBe(90);
    expect(s.contextThreshold).toBe(150_000);
    expect([...s.excludedKeys]).toEqual(['k']);
  });

  it('fails while a retired environment variable is set', () => {
    vi.stubEnv('EXCLUDED_SESSION_KEYS', 'a,b');
    expect(() => liveSettings()).toThrow(
      'jobs.admin-refresh-sessions.excludedKeys',
    );
  });
});

describe('liveRpc', () => {
  it('waits longer for a reset than for a read', async () => {
    await liveRpc('sessions.list', { limit: 1 });
    await liveRpc('sessions.reset', { key: 'k' });
    expect(mocks.gatewayRpc.mock.calls).toEqual([
      ['sessions.list', { limit: 1 }, undefined, { waitMs: READ_WAIT_MS }],
      ['sessions.reset', { key: 'k' }, undefined, { waitMs: RESET_WAIT_MS }],
    ]);
  });
});

describe('openUsageReader', () => {
  it('opens each agent DB once, read-only, and closes them all', () => {
    const fx = createV23Fixture(path.join(root, 'agents', 'ops'));
    fx.addHotSession('s1', [usage(T10, 7)]);
    fx.addHotSession('s2', [usage(T10, 9)]);
    fx.close();
    const exists = vi.fn(fs.existsSync);
    const reader = openUsageReader(dbPathFor, exists);
    expect(reader.usage('ops', 's1')).toMatchObject({ input: 7 });
    expect(reader.usage('ops', 's2')).toMatchObject({ input: 9 });
    expect(reader.usage('ops', 'none')).toBeUndefined();
    expect(exists).toHaveBeenCalledTimes(1);
    reader.close();
    reader.close();
  });

  it('fails for an agent with no DB, naming OpenClaw 2026.9', () => {
    const reader = openUsageReader(dbPathFor);
    expect(() => reader.usage('main', 's')).toThrow(
      /agent DB for agent main not found at .*needs OpenClaw 2026\.9 or later/,
    );
  });

  it('fails on an unsupported schema', () => {
    createV23Fixture(path.join(root, 'agents', 'main'), 99).close();
    expect(() => openUsageReader(dbPathFor).usage('main', 's')).toThrow(
      'found 99',
    );
  });
});

describe('liveSlack', () => {
  it("uses the account's bot token", () => {
    expect(liveSlack('work').postMessage).toBeTypeOf('function');
    expect(mocks.slackBotToken).toHaveBeenCalledWith('work');
  });
});

describe('sessionRefreshDoctorCheck', () => {
  const okReader = (): UsageReader => ({
    usage: () => undefined,
    close: vi.fn(),
  });

  /** A gateway listing sessions of the given keys (one page). */
  const listing = (...keys: string[]) =>
    vi.fn(() =>
      Promise.resolve({
        sessions: keys.map((key, i) => ({ key, sessionId: `s${String(i)}` })),
      }),
    );

  it('passes when every listed agent DB reads and the gateway answers', async () => {
    const rpc = listing('agent:ops:main', 'agent:ops:slack:channel:c1');
    const usageFn = vi.fn(() => undefined);
    const close = vi.fn();
    await expect(
      sessionRefreshDoctorCheck(rpc, () => ({ usage: usageFn, close })),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'sessions.list',
      expect.objectContaining({ offset: 0 }),
    );
    // Each listed agent once; never a hardcoded `main`.
    expect(usageFn.mock.calls).toEqual([['ops', '']]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes with nothing listed, reading no DB', async () => {
    const usageFn = vi.fn(() => undefined);
    await expect(
      sessionRefreshDoctorCheck(listing(), () => ({
        usage: usageFn,
        close: vi.fn(),
      })),
    ).resolves.toBe(true);
    expect(usageFn).not.toHaveBeenCalled();
  });

  it('reports an unreadable agent DB for a listed agent', async () => {
    const reader = () => openUsageReader(dbPathFor);
    await expect(
      sessionRefreshDoctorCheck(listing('agent:ops:main'), reader),
    ).resolves.toMatch(/^agent DB: OpenClaw agent DB for agent ops not found/);
  });

  it('reports a malformed list as a gateway problem', async () => {
    await expect(
      sessionRefreshDoctorCheck(() => Promise.resolve({}), okReader),
    ).resolves.toMatch(
      /^gateway: gateway sessions.list returned an unexpected shape/,
    );
  });

  it('reports an unreachable gateway', async () => {
    await expect(
      sessionRefreshDoctorCheck(
        () => Promise.reject(new Error('ECONNREFUSED')),
        okReader,
      ),
    ).resolves.toBe('gateway: ECONNREFUSED');
  });

  it("defaults to the live RPC and the reader under OpenClaw's state directory", async () => {
    vi.stubEnv('USERPROFILE', root);
    mocks.gatewayRpc.mockResolvedValueOnce({
      sessions: [{ key: 'agent:main:main', sessionId: 's' }],
    });
    await expect(sessionRefreshDoctorCheck()).resolves.toContain(
      path.join(root, '.openclaw', 'agents', 'main'),
    );
    expect(mocks.gatewayRpc).toHaveBeenCalledTimes(1);
  });
});
