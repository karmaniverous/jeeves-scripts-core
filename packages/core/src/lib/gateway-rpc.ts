/**
 * @module gateway-rpc
 *
 * Call an OpenClaw gateway RPC method (e.g. `chat.history`) through the
 * documented `openclaw gateway call <method> --json --params <json>`
 * helper. Use this for gateway methods that are not exposed as HTTP
 * tools (gateway-client.ts `/tools/invoke`), or whose tool wrapper
 * applies limits the RPC lets a caller override.
 *
 * The CLI runs under the current Node binary (no shell), so the JSON
 * params reach it as one argv entry on every platform. It resolves the
 * gateway URL and token from the local OpenClaw config.
 *
 * Config dependencies: the global openclaw install (resolve-openclaw-dist.ts).
 */

import { execFile } from 'node:child_process';
import path from 'node:path';

import { resolveOpenClawDist } from '../admin/lib/resolve-openclaw-dist.js';
import { isRecord } from './is-record.js';

/** Gateway RPC caller: resolves with the method's result payload. */
export type GatewayRpc = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

/** Wall-clock limit for one CLI call (CLI startup is several seconds). */
const CALL_TIMEOUT_MS = 120_000;

/** Largest stdout accepted from one CLI call. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Path to the global `openclaw.mjs` CLI entry point. */
export function resolveOpenClawCli(): string {
  return path.join(path.dirname(resolveOpenClawDist()), 'openclaw.mjs');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A gateway call the gateway rejected: the CLI's `{ ok: false, error }`
 * answer, with the gateway's error `code` (e.g. `INVALID_REQUEST`) and
 * machine-readable `details` (e.g. `{ reason: 'session-changed' }`) when
 * it sent them.
 */
export class GatewayRpcError extends Error {
  /**
   * @param method - The gateway method.
   * @param detail - The gateway's error message.
   * @param code - The gateway's error code, when given.
   * @param details - The gateway's error details, when given.
   */
  constructor(
    readonly method: string,
    detail: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(`gateway ${method} failed: ${detail}`);
    this.name = 'GatewayRpcError';
  }
}

/** The gateway error in a `{ ok: false, error }` CLI response, if it is one. */
function cliError(
  method: string,
  parsed: unknown,
): GatewayRpcError | undefined {
  if (!isRecord(parsed) || parsed.ok !== false) return undefined;
  const error = isRecord(parsed.error) ? parsed.error : {};
  return new GatewayRpcError(
    method,
    typeof error.message === 'string' ? error.message : 'unknown gateway error',
    typeof error.code === 'string' ? error.code : undefined,
    error.details,
  );
}

/** Options for {@link gatewayRpc}. */
export interface GatewayRpcOptions {
  /** How long the CLI waits for the gateway's answer (its `--timeout`;
   * unset: the CLI's own default, 10 s). */
  waitMs?: number;
}

/**
 * Call a gateway RPC method.
 *
 * @param method - Gateway method name (e.g. `chat.history`).
 * @param params - Method params (sent as JSON).
 * @param cliPath - Path to `openclaw.mjs` (resolved from the global install
 *   when omitted).
 * @param options - The CLI's wait for the answer.
 * @returns The method's result payload.
 * @throws {@link GatewayRpcError} when the gateway rejects the call; Error
 *   when the CLI fails or the output is not JSON.
 */
export function gatewayRpc(
  method: string,
  params: Record<string, unknown>,
  cliPath: string = resolveOpenClawCli(),
  options: GatewayRpcOptions = {},
): Promise<unknown> {
  const args = [
    cliPath,
    'gateway',
    'call',
    method,
    '--json',
    '--params',
    JSON.stringify(params),
    ...(options.waitMs === undefined
      ? []
      : ['--timeout', String(options.waitMs)]),
  ];
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: CALL_TIMEOUT_MS,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const parsed = parseJson(stdout);
        const gatewayError = cliError(method, parsed);
        if (gatewayError) {
          reject(gatewayError);
          return;
        }
        if (err) {
          const detail = stderr.trim() || err.message;
          reject(new Error(`gateway ${method} failed: ${detail}`));
          return;
        }
        if (parsed === undefined) {
          reject(new Error(`gateway ${method} returned invalid JSON`));
          return;
        }
        resolve(parsed);
      },
    );
  });
}
