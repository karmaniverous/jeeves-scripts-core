/**
 * @module gateway-client
 *
 * Shared Gateway HTTP client — token loading, tool invocation, and
 * result unwrapping for the OpenClaw gateway API.
 *
 * Used by spawn-worker.ts (session spawning) and meetings/lib/gateway-client.ts
 * (meeting extraction via gateway tools). Loads the bearer token from
 * the OpenClaw config or the CLAWDBOT_GATEWAY_TOKEN env var (lib/openclaw-config).
 *
 * Config dependencies: constants().GATEWAY_HOST, constants().GATEWAY_PORT from constants.ts.
 */

import http from 'node:http';

import { constants } from './constants.js';
import { gatewayToken } from './openclaw-config.js';

// ── Types ───────────────────────────────────────────────────────────

export interface GatewayInvokeResult {
  ok?: boolean;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/** Gateway tool invoker ({@link gatewayInvoke} or a test double). */
export type GatewayInvoker = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// ── Token loading ───────────────────────────────────────────────────

/**
 * The gateway bearer token: `CLAWDBOT_GATEWAY_TOKEN`, else `gateway.auth.token`
 * in the OpenClaw config (see `lib/openclaw-config`); `null` when neither exists.
 */
export function loadGatewayToken(): string | null {
  return gatewayToken();
}

// ── Tool invocation ─────────────────────────────────────────────────

export function gatewayInvoke(
  tool: string,
  args: Record<string, unknown>,
  options?: { sessionKey?: string },
): Promise<unknown> {
  const token = loadGatewayToken();
  if (!token) throw new Error('No gateway token found');

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      tool,
      args,
      ...(options?.sessionKey ? { sessionKey: options.sessionKey } : {}),
    });
    const req = http.request(
      {
        hostname: constants().GATEWAY_HOST,
        port: constants().GATEWAY_PORT,
        path: '/tools/invoke',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const resp = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown;
          try {
            parsed = JSON.parse(resp);
          } catch {
            reject(new Error(`Gateway invalid JSON: ${resp}`));
            return;
          }
          const typed = parsed as GatewayInvokeResult;
          if (res.statusCode === 200 && typed.ok) {
            resolve(typed.result);
            return;
          }
          reject(new Error(typed.error?.message ?? resp));
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Result helpers ──────────────────────────────────────────────────

export function unwrapResult(r: unknown): Record<string, unknown> {
  if (r && typeof r === 'object' && 'details' in r) {
    return (r as { details: Record<string, unknown> }).details;
  }
  if (r && typeof r === 'object') return r as Record<string, unknown>;
  return {};
}
