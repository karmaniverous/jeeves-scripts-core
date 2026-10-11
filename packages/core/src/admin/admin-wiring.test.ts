/**
 * Tests of the token-metrics and session-refresh runnables' live wiring
 * over a temp config (`useTempConfig`): the rate-card and pending-model
 * collaborators read and write the files config names, and argument
 * errors stop a run before it touches any source. (The OpenClaw agent DB
 * and runner store are host resources; their use is tested through the
 * injected seams in lib/.)
 */

import fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { constants } from '../lib/constants.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import { collectDeps } from './collect-token-metrics.js';
import { openTokenMetricsState } from './lib/token-metrics-state.js';
import { refreshRatesDeps } from './refresh-token-rates.js';
import { regenDeps, regenerate } from './regenerate-token-metrics.js';
import { sessionRefreshDeps } from './session-refresh.js';

useTempConfig();

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
    await regenerate(['--dry-run'], regenDeps());
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
