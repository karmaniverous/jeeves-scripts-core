import { describe, expect, it } from 'vitest';

import { configSchema } from './schema.js';

const MINIMAL_CONFIG = {
  instance: { name: 'test', baseDir: 'J:/' },
};

describe('configSchema', () => {
  it('accepts a minimal config, deriving empty defaults', () => {
    const result = configSchema.parse(MINIMAL_CONFIG);
    expect(result.instance).toEqual({ name: 'test', baseDir: 'J:/' });
    expect(result.paths).toEqual({});
    expect(result.siloRouting).toEqual({ silos: {} });
    expect(result.jobs).toEqual({});
    expect(result.extensions).toEqual({});
    expect(result.pipeline).toBeUndefined();
  });

  it('rejects a missing instance.baseDir', () => {
    expect(() => configSchema.parse({ instance: { name: 'test' } })).toThrow();
  });

  it('accepts a full pipeline + siloRouting + jobs block', () => {
    const result = configSchema.parse({
      instance: { name: 'jgs', baseDir: 'J:/' },
      paths: { contentDir: 'J:/domains' },
      integrations: { gh: { account: 'karmaniverous' } },
      pipeline: {
        accounts: [
          {
            email: 'a@example.com',
            type: 'gmail',
            emailPolling: true,
          },
        ],
        buckets: { domains: [], priority: [] },
        refs: {},
        emailConfig: {
          reportOnly: false,
          receipt: { forwardEnabled: false, sparkReceiptsForwardTo: '' },
          digest: { slackChannelId: 'C1' },
        },
      },
      siloRouting: {
        defaultBasePath: 'J:/domains',
        silos: {
          tcs: { basePath: 'J:/tcs' },
        },
      },
      jobs: {
        'email-poll': { enabled: true },
      },
    });
    expect(result.pipeline?.accounts).toHaveLength(1);
    expect(result.siloRouting.silos.tcs.basePath).toBe('J:/tcs');
    expect(result.jobs['email-poll'].enabled).toBe(true);
  });

  it('rejects a literal secret value anywhere in the tree', () => {
    expect(() =>
      configSchema.parse({
        ...MINIMAL_CONFIG,
        integrations: { jira: { apiKey: 'literal-secret' } },
      }),
    ).toThrow(/must not hold a literal secret value/);
  });

  it('still accepts a deprecated literal imap.password (exempt subtree)', () => {
    const result = configSchema.parse({
      ...MINIMAL_CONFIG,
      pipeline: {
        accounts: [
          {
            email: 'a@example.com',
            type: 'imap',
            emailPolling: true,
            imap: {
              host: 'imap.example.com',
              port: 993,
              tls: true,
              user: 'a@example.com',
              password: 'plain-text',
            },
          },
        ],
        buckets: { domains: [], priority: [] },
        refs: {},
        emailConfig: {
          reportOnly: false,
          receipt: { forwardEnabled: false, sparkReceiptsForwardTo: '' },
          digest: { slackChannelId: 'C1' },
        },
      },
    });
    expect(result.pipeline?.accounts[0].imap?.password).toBe('plain-text');
  });
});
