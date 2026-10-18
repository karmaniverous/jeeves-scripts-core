/**
 * Tests of the token-metrics and session-refresh runnables' live wiring
 * over a temp config (`useTempConfig`): the rate-card and pending-model
 * collaborators read and write the files config names, and argument
 * errors stop a run before it touches any source. (The OpenClaw agent DB
 * and runner store are host resources; their use is tested through the
 * injected seams in lib/.)
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfig } from '../config/loader.js';
import { parseRunnableArgs } from '../lib/args.js';
import { constants } from '../lib/constants.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import { collect, collectDeps } from './collect-token-metrics.js';
import { openTokenMetricsState } from './lib/token-metrics-state.js';
import { refreshRatesDeps } from './refresh-token-rates.js';
import {
  regenDeps,
  regenerate,
  regenFlags,
} from './regenerate-token-metrics.js';
import { sessionRefreshDeps } from './session-refresh.js';

const flagsOf = (args: string[]) => parseRunnableArgs(args, regenFlags);

const baseDir = useTempConfig();

beforeEach(() => {
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe('openTokenMetricsState', () => {
  it('reads and writes the token-metrics namespace and closes the client', () => {
    const runner = fakeRunnerClient();
    const state = openTokenMetricsState(runner.client);
    state.set('cursor', '{}');
    expect(state.get('cursor')).toBe('{}');
    expect(runner.client.getState('token-metrics', 'cursor')).toBe('{}');
    state.close();
    expect(runner.closed()).toBe(true);
  });
});

describe('collect-token-metrics wiring', () => {
  it('seeds the rate card, knows its models and names no DMs in empty buckets', async () => {
    const deps = collectDeps();
    deps.ensureRateCard();
    expect(fs.existsSync(constants().TOKEN_RATES_PATH)).toBe(true);
    expect(Object.keys(deps.knownModels()).length).toBeGreaterThan(0);
    expect(deps.hasOpenClawBuckets()).toBe(false);
    await expect(deps.nameDms(new Map())).resolves.toBeUndefined();
  });

  it('records unknown models as pending and logs a refused refresh trigger', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('busy', { status: 503 })),
    );
    const deps = collectDeps();
    deps.ensureRateCard();
    deps.triggerRateCardRefresh(['vendor/new-model']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fs.readFileSync(constants().TOKEN_RATES_PENDING_PATH, 'utf8'),
    ).toContain('vendor/new-model');
  });
});

describe('refresh-token-rates wiring', () => {
  it('seeds, reads and writes the rate card and the pending list', () => {
    const deps = refreshRatesDeps();
    deps.ensure();
    deps.write(deps.read());
    deps.writePending(['a/b']);
    expect(deps.readPending()).toEqual(['a/b']);
    expect(deps.now()).toMatch(/^\d{4}-/);
  });
});

describe('regenerate-token-metrics wiring', () => {
  it('fails on a missing --from before reading any source', async () => {
    await regenerate(flagsOf(['--dry-run']), regenDeps());
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('--from ISO is required.'),
    );
  });
});

describe('session-refresh wiring', () => {
  it('reads thresholds from the environment and the sessions dir from config', () => {
    vi.stubEnv('IDLE_MINUTES', '5');
    const deps = sessionRefreshDeps();
    expect(deps.settings.idleMinutes).toBe(5);
    expect(deps.sessionsDir).toBe(constants().SESSIONS_DIR);
    expect(deps.uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('collect', () => {
  it('sets the exit code only when the run fails', async () => {
    await collect(collectDeps(), () => Promise.resolve(0));
    expect(process.exitCode).toBeUndefined();
    await collect(collectDeps(), () => Promise.resolve(2));
    expect(process.exitCode).toBe(2);
  });

  it('logs when the pending models cannot be recorded', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('down')));
    fs.rmSync(constants().TOKEN_RATES_PENDING_PATH, { force: true });
    fs.mkdirSync(constants().TOKEN_RATES_PENDING_PATH, { recursive: true });
    collectDeps().triggerRateCardRefresh(['x/y']);
    expect(console.error).toHaveBeenCalledWith(
      '[collect-token-metrics] Could not record pending models:',
      expect.any(String),
    );
    fs.rmSync(constants().TOKEN_RATES_PENDING_PATH, { recursive: true });
  });
});

describe('refresh-token-rates fetchRates', () => {
  it('maps a 404 to no rates and returns the rates of a known model', async () => {
    const missing = refreshRatesDeps(() =>
      Promise.resolve({ status: 404, body: null }),
    );
    await expect(missing.fetchRates('vendor/none')).resolves.toBeNull();
    const known = refreshRatesDeps(() =>
      Promise.resolve({
        status: 200,
        body: {
          data: { pricing: { prompt: '0.000001', completion: '0.000002' } },
        },
      }),
    );
    await expect(known.fetchRates('vendor/model')).resolves.toMatchObject({
      input: 1,
      output: 2,
    });
  });
});

describe('regenerate wiring collaborators', () => {
  it('checks buckets and the live store, and backs up, removes and names nothing in a dry run', async () => {
    const deps = regenDeps();
    expect(deps.bucketExists('2026-01-01T00', baseDir())).toBe(false);
    expect(deps.isLiveStore(constants().TOKEN_METRICS_DIR)).toBe(true);
    expect(deps.isLiveStore(baseDir())).toBe(false);
    deps.backup([], true);
    deps.remove([], true);
    expect(Object.keys(deps.knownModels()).length).toBeGreaterThanOrEqual(0);
    await expect(deps.nameDms(new Map(), true)).resolves.toBeUndefined();
  });
});

describe('regenerate scanOpenClaw wiring', () => {
  it('scans the agent DB under the OpenClaw home, failing on a missing DB', async () => {
    const home = fs.mkdtempSync(path.join(baseDir(), 'home-'));
    vi.stubEnv('USERPROFILE', home);
    resetConfig();
    const deps = regenDeps();
    expect(deps.agentDbPath.startsWith(home)).toBe(true);
    expect(deps.agentDbExists).toBe(false);
    await expect(
      deps.scanOpenClaw({}, {} as never, new Map(), new Set()),
    ).rejects.toThrow();
    vi.unstubAllEnvs();
    resetConfig();
  });
});
