/**
 * Tests for gateway-rpc: the CLI is run under the current Node binary
 * with the params as one JSON argv entry, and gateway/CLI failures and
 * non-JSON output reject.
 */

import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveOpenClawDist: vi.fn(() => '/npm/openclaw/dist'),
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('../admin/lib/resolve-openclaw-dist.js', () => ({
  resolveOpenClawDist: mocks.resolveOpenClawDist,
}));

import {
  gatewayRpc,
  GatewayRpcError,
  resolveOpenClawCli,
} from './gateway-rpc.js';

/** Make the next execFile call complete with these results. */
function nextExec(err: Error | null, stdout: string, stderr = ''): void {
  mocks.execFile.mockImplementationOnce(
    (_file: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      cb(err, stdout, stderr);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveOpenClawCli', () => {
  it('points at openclaw.mjs next to the global dist directory', () => {
    expect(resolveOpenClawCli()).toBe(
      path.join('/npm/openclaw', 'openclaw.mjs'),
    );
  });
});

describe('gatewayRpc', () => {
  it('runs `gateway call` with JSON params and resolves the result', async () => {
    nextExec(null, '{"messages":[{"role":"assistant"}]}\n');
    const params = { sessionKey: 'agent:main:x', maxChars: 500_000 };

    await expect(
      gatewayRpc('chat.history', params, '/cli.mjs'),
    ).resolves.toEqual({ messages: [{ role: 'assistant' }] });
    const [file, args, opts] = mocks.execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(file).toBe(process.execPath);
    expect(args).toEqual([
      '/cli.mjs',
      'gateway',
      'call',
      'chat.history',
      '--json',
      '--params',
      JSON.stringify(params),
    ]);
    expect(opts).toMatchObject({ windowsHide: true });
    expect(opts.shell).toBeUndefined();
  });

  it('passes a wait for the answer as the CLI --timeout, only when given', async () => {
    nextExec(null, '{}');
    await gatewayRpc('skills.status', {}, '/cli.mjs', { waitMs: 60_000 });
    expect(mocks.execFile.mock.calls[0]?.[1]).toEqual([
      '/cli.mjs',
      'gateway',
      'call',
      'skills.status',
      '--json',
      '--params',
      '{}',
      '--timeout',
      '60000',
    ]);
  });

  it('resolves the CLI path when none is given', async () => {
    nextExec(null, '{}');
    await gatewayRpc('status', {});
    const args = mocks.execFile.mock.calls[0]?.[1] as string[];
    expect(args[0]).toBe(path.join('/npm/openclaw', 'openclaw.mjs'));
  });

  it('rejects with the gateway error message', async () => {
    nextExec(
      new Error('Command failed'),
      JSON.stringify({
        ok: false,
        error: { message: 'at /maxChars: must be <= 500000' },
      }),
    );
    await expect(gatewayRpc('chat.history', {}, '/cli.mjs')).rejects.toThrow(
      'gateway chat.history failed: at /maxChars: must be <= 500000',
    );
  });

  it('rejects a gateway error without a message', async () => {
    nextExec(null, '{"ok":false}');
    await expect(gatewayRpc('x', {}, '/cli.mjs')).rejects.toThrow(
      'gateway x failed: unknown gateway error',
    );
  });

  it("carries the gateway's error code and details (the CLI's request-error JSON)", async () => {
    nextExec(
      new Error('Command failed'),
      JSON.stringify({
        ok: false,
        error: {
          type: 'gateway_request_error',
          code: 'INVALID_REQUEST',
          message: 'session changed',
          details: { reason: 'session-changed' },
          retryable: false,
        },
      }),
    );
    const err: unknown = await gatewayRpc(
      'sessions.reset',
      {},
      '/cli.mjs',
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayRpcError);
    expect(err).toMatchObject({
      method: 'sessions.reset',
      code: 'INVALID_REQUEST',
      details: { reason: 'session-changed' },
      message: 'gateway sessions.reset failed: session changed',
    });
  });

  it('leaves code and details unset when the gateway sends none', async () => {
    nextExec(null, '{"ok":false,"error":"flat"}');
    const err: unknown = await gatewayRpc('x', {}, '/cli.mjs').catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      message: 'gateway x failed: unknown gateway error',
      code: undefined,
      details: undefined,
    });
  });

  it('rejects CLI failures with stderr, else the exec error', async () => {
    nextExec(new Error('spawn EPERM'), '', 'gateway unreachable\n');
    await expect(gatewayRpc('x', {}, '/cli.mjs')).rejects.toThrow(
      'gateway x failed: gateway unreachable',
    );
    nextExec(new Error('timed out'), '', '');
    await expect(gatewayRpc('x', {}, '/cli.mjs')).rejects.toThrow(
      'gateway x failed: timed out',
    );
  });

  it('rejects non-JSON output', async () => {
    nextExec(null, 'not json');
    await expect(gatewayRpc('x', {}, '/cli.mjs')).rejects.toThrow(
      'gateway x returned invalid JSON',
    );
  });
});
