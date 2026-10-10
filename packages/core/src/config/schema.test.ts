import { describe, expect, it } from 'vitest';

import { configSchema } from './schema.js';

const MINIMAL_CONFIG = {
  instance: { name: 'test', baseDir: '/base' },
};

describe('configSchema', () => {
  it('accepts a minimal config, deriving empty defaults', () => {
    const result = configSchema.parse(MINIMAL_CONFIG);
    expect(result.instance).toEqual({ name: 'test', baseDir: '/base' });
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
      instance: { name: 'acme', baseDir: '/base' },
      paths: { contentDir: '/base/domains' },
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
          digest: { slackChannelId: 'C1' },
        },
      },
      siloRouting: {
        defaultBasePath: '/base/domains',
        silos: {
          tcs: { basePath: '/base/tcs' },
        },
      },
      jobs: {
        'email-poll': { enabled: true },
      },
    });
    expect(result.pipeline?.accounts).toHaveLength(1);
    expect(result.siloRouting.silos.tcs?.basePath).toBe('/base/tcs');
    expect(result.jobs['email-poll']?.enabled).toBe(true);
  });

  it('rejects a literal secret value anywhere in the tree', () => {
    expect(() =>
      configSchema.parse({
        ...MINIMAL_CONFIG,
        integrations: { jira: { apiKey: 'literal-secret' } },
      }),
    ).toThrow(/must not hold a literal secret value/);
  });

  it('rejects a literal imap.password and accepts a secretRef', () => {
    const withPassword = (password: unknown) => ({
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
              password,
            },
          },
        ],
        buckets: { domains: [], priority: [] },
        refs: {},
        emailConfig: {
          reportOnly: false,
          digest: { slackChannelId: 'C1' },
        },
      },
    });
    expect(() => configSchema.parse(withPassword('plain-text'))).toThrow(
      /must not hold a literal secret value/,
    );
    const result = configSchema.parse(withPassword({ secretRef: 'carol' }));
    expect(result.pipeline?.accounts[0]?.imap?.password).toEqual({
      secretRef: 'carol',
    });
  });
});
