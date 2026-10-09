/**
 * @module gateway-client (meetings)
 *
 * Re-exports the shared Gateway HTTP client with meetings-specific defaults.
 */

import { sleepAsync as sleep } from '@karmaniverous/jeeves';

import { gatewayInvoke as sharedGatewayInvoke } from '../../lib/gateway-client.js';

export { sleep };
export type { GatewayInvokeResult } from '../../lib/gateway-client.js';
export { loadGatewayToken, unwrapResult } from '../../lib/gateway-client.js';

/**
 * Meetings-specific gateway invocation — always includes the
 * `agent:main:main` session key.
 */
export function gatewayInvoke(
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return sharedGatewayInvoke(tool, args, {
    sessionKey: 'agent:main:main',
  });
}
