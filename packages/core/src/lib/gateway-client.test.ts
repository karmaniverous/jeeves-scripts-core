import { afterEach, describe, expect, it, vi } from 'vitest';

describe('gateway-client', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  describe('loadGatewayToken', () => {
    it('returns env var when CLAWDBOT_GATEWAY_TOKEN is set', async () => {
      process.env['CLAWDBOT_GATEWAY_TOKEN'] = 'test-token-123';
      const { loadGatewayToken } = await import('./gateway-client.js');
      expect(loadGatewayToken()).toBe('test-token-123');
    });

    it('returns null when no token source is available', async () => {
      delete process.env['CLAWDBOT_GATEWAY_TOKEN'];
      vi.doMock('node:fs', () => ({
        default: {
          readFileSync: () => {
            throw new Error('ENOENT');
          },
        },
      }));
      const { loadGatewayToken } = await import('./gateway-client.js');
      expect(loadGatewayToken()).toBeNull();
    });

    it('reads token from config file when env var is unset', async () => {
      delete process.env['CLAWDBOT_GATEWAY_TOKEN'];
      const configContent = JSON.stringify({
        gateway: { auth: { token: 'file-token-456' } },
      });
      vi.doMock('node:fs', () => ({
        default: {
          readFileSync: () => configContent,
        },
      }));
      const { loadGatewayToken } = await import('./gateway-client.js');
      expect(loadGatewayToken()).toBe('file-token-456');
    });
  });

  describe('unwrapResult', () => {
    it('extracts details from result object', async () => {
      const { unwrapResult } = await import('./gateway-client.js');
      const result = { details: { sessionId: 'abc' } };
      expect(unwrapResult(result)).toEqual({ sessionId: 'abc' });
    });

    it('returns object as-is when no details key', async () => {
      const { unwrapResult } = await import('./gateway-client.js');
      const result = { foo: 'bar' };
      expect(unwrapResult(result)).toEqual({ foo: 'bar' });
    });

    it('returns empty object for non-object input', async () => {
      const { unwrapResult } = await import('./gateway-client.js');
      expect(unwrapResult(null)).toEqual({});
      expect(unwrapResult(undefined)).toEqual({});
    });
  });
});
