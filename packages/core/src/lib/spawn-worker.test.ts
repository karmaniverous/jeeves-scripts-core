import { describe, expect, it, vi } from 'vitest';

import {
  parseArgs,
  SPAWN_BACKOFF_BASE_MS,
  SPAWN_MAX_RETRIES,
  type SpawnArgs,
  type SpawnDeps,
  spawnWithRetry,
} from './spawn-worker.js';
import type { GatewayResponse } from './worker-session.js';

describe('parseArgs', () => {
  it('parses --key=value pairs', () => {
    const result = parseArgs(['--job-id=abc123', '--label=test']);
    expect(result).toEqual({
      'job-id': 'abc123',
      label: 'test',
    });
  });

  it('ignores non-flag arguments', () => {
    const result = parseArgs(['positional', '--key=val', 'another']);
    expect(result).toEqual({ key: 'val' });
  });

  it('handles empty value', () => {
    const result = parseArgs(['--key=']);
    expect(result).toEqual({ key: '' });
  });

  it('handles value with equals sign', () => {
    const result = parseArgs(['--key=a=b']);
    expect(result).toEqual({ key: 'a=b' });
  });

  it('returns empty object for no args', () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe('spawnWithRetry', () => {
  const spawnArgs: SpawnArgs = { task: 't', label: 'worker-x', thread: false };

  const makeDeps = (...responses: (GatewayResponse | Error)[]) => {
    const invoke = vi.fn<SpawnDeps['invoke']>();
    for (const r of responses) {
      if (r instanceof Error) invoke.mockRejectedValueOnce(r);
      else invoke.mockResolvedValueOnce(r);
    }
    const sleep = vi.fn<SpawnDeps['sleep']>().mockResolvedValue(undefined);
    return { invoke, sleep };
  };

  const ok = (key: string): GatewayResponse => ({
    ok: true,
    result: { details: { childSessionKey: key } },
  });

  it('returns the child session key and passes the spawn args through', async () => {
    const deps = makeDeps(ok('agent:main:subagent:1'));
    const { sessionKey } = await spawnWithRetry(spawnArgs, deps);
    expect(sessionKey).toBe('agent:main:subagent:1');
    expect(deps.invoke).toHaveBeenCalledWith('sessions_spawn', spawnArgs);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('falls back to details.sessionKey', async () => {
    const deps = makeDeps({
      ok: true,
      result: { details: { sessionKey: 's2' } },
    });
    expect((await spawnWithRetry(spawnArgs, deps)).sessionKey).toBe('s2');
  });

  it('retries a gateway timeout in the response body with doubling backoff', async () => {
    const timeoutBody: GatewayResponse = {
      ok: true,
      error: { message: 'Gateway Timeout' },
    };
    const deps = makeDeps(timeoutBody, timeoutBody, ok('s3'));
    expect((await spawnWithRetry(spawnArgs, deps)).sessionKey).toBe('s3');
    expect(deps.sleep.mock.calls).toEqual([
      [SPAWN_BACKOFF_BASE_MS],
      [SPAWN_BACKOFF_BASE_MS * 2],
    ]);
  });

  it('retries a thrown timeout, then rethrows it on the last attempt', async () => {
    const err = new Error('Gateway request timed out (timeout)');
    const deps = makeDeps(
      ...Array.from({ length: SPAWN_MAX_RETRIES }, () => err),
    );
    await expect(spawnWithRetry(spawnArgs, deps)).rejects.toBe(err);
    expect(deps.invoke).toHaveBeenCalledTimes(SPAWN_MAX_RETRIES);
    expect(deps.sleep).toHaveBeenCalledTimes(SPAWN_MAX_RETRIES - 1);
  });

  it('does not retry other errors', async () => {
    const deps = makeDeps(new Error('HTTP 401'));
    await expect(spawnWithRetry(spawnArgs, deps)).rejects.toThrow('HTTP 401');
    expect(deps.invoke).toHaveBeenCalledTimes(1);
  });

  it('fails when the result carries no session key', async () => {
    const deps = makeDeps({ ok: true, result: { details: {} } });
    await expect(spawnWithRetry(spawnArgs, deps)).rejects.toThrow(
      'No sessionKey in spawn result',
    );
  });

  it('gives up after the last body timeout without a final wait', async () => {
    const timeoutBody: GatewayResponse = {
      ok: true,
      error: { message: 'gateway timeout' },
    };
    const deps = makeDeps(
      ...Array.from({ length: SPAWN_MAX_RETRIES }, () => timeoutBody),
    );
    await expect(spawnWithRetry(spawnArgs, deps)).rejects.toThrow(
      'gateway timeout in response body',
    );
    expect(deps.sleep).toHaveBeenCalledTimes(SPAWN_MAX_RETRIES - 1);
  });
});
