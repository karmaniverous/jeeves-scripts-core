import { afterEach, describe, expect, it, vi } from 'vitest';

import { derivePaths } from './paths.js';
import { type Config } from './schema.js';

const baseConfig = (overrides: Partial<Config['paths']> = {}): Config =>
  ({
    instance: { name: 'test', baseDir: 'J:/' },
    paths: overrides,
    integrations: {},
    siloRouting: { silos: {} },
    jobs: {},
    extensions: {},
  }) as unknown as Config;

describe('derivePaths', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives every path from instance.baseDir with no overrides', () => {
    const result = derivePaths(baseConfig());
    expect(result.configDir.replace(/\\/g, '/')).toBe('J:/config');
    expect(result.contentDir.replace(/\\/g, '/')).toBe('J:/content');
    expect(result.scriptsDir.replace(/\\/g, '/')).toBe('J:/jeeves-scripts');
    expect(result.credentialsDir.replace(/\\/g, '/')).toBe(
      'J:/config/credentials',
    );
    expect(result.stateDir.replace(/\\/g, '/')).toBe('J:/state');
    expect(result.gogHome.replace(/\\/g, '/')).toBe('J:/config/gogcli');
    expect(result.tokenMetricsDir.replace(/\\/g, '/')).toBe(
      'J:/state/jeeves-runner/token-metrics',
    );
  });

  it('honours explicit paths overrides (JGS: gogHome under credentialsDir)', () => {
    const result = derivePaths(
      baseConfig({ gogHome: 'J:/config/credentials/gogcli' }),
    );
    expect(result.gogHome.replace(/\\/g, '/')).toBe(
      'J:/config/credentials/gogcli',
    );
  });

  it('GOG_HOME env wins over both the override and the default', () => {
    vi.stubEnv('GOG_HOME', '/env/gog-home');
    const result = derivePaths(baseConfig({ gogHome: 'J:/override' }));
    expect(result.gogHome).toBe('/env/gog-home');
  });

  it('TOKEN_METRICS_DIR env wins over the default', () => {
    vi.stubEnv('TOKEN_METRICS_DIR', '/env/token-metrics');
    const result = derivePaths(baseConfig());
    expect(result.tokenMetricsDir).toBe('/env/token-metrics');
  });

  it('derives imapSecretsDir from credentialsDir', () => {
    const result = derivePaths(baseConfig());
    expect(result.imapSecretsDir.replace(/\\/g, '/')).toBe(
      'J:/config/credentials/imap',
    );
  });
});
