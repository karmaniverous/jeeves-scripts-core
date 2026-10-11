import { afterEach, describe, expect, it, vi } from 'vitest';

import { derivePaths } from './paths.js';
import { type Config } from './schema.js';

const baseConfig = (
  overrides: Partial<Config['paths']> = {},
  baseDir = '/base',
): Config =>
  ({
    instance: { name: 'test', baseDir },
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
    expect(result.configDir.replace(/\\/g, '/')).toBe('/base/config');
    expect(result.contentDir.replace(/\\/g, '/')).toBe('/base/content');
    expect(result.scriptsDir.replace(/\\/g, '/')).toBe('/base/jeeves-scripts');
    expect(result.credentialsDir.replace(/\\/g, '/')).toBe(
      '/base/config/credentials',
    );
    expect(result.stateDir.replace(/\\/g, '/')).toBe('/base/state');
    expect(result.gogHome.replace(/\\/g, '/')).toBe('/base/config/gogcli');
    expect(result.tokenMetricsDir.replace(/\\/g, '/')).toBe(
      '/base/state/jeeves-runner/token-metrics',
    );
  });

  it.each([
    ['Windows', 'D:/', 'D:/config'],
    ['POSIX', '/srv/jeeves', '/srv/jeeves/config'],
  ])('derives from a %s baseDir', (_kind, baseDir, configDir) => {
    const result = derivePaths(baseConfig({}, baseDir));
    expect(result.configDir.replace(/\\/g, '/')).toBe(configDir);
  });

  it('honours explicit paths overrides (gogHome under credentialsDir)', () => {
    const result = derivePaths(
      baseConfig({ gogHome: '/base/config/credentials/gogcli' }),
    );
    expect(result.gogHome.replace(/\\/g, '/')).toBe(
      '/base/config/credentials/gogcli',
    );
  });

  it('GOG_HOME env wins over both the override and the default', () => {
    vi.stubEnv('GOG_HOME', '/env/gog-home');
    const result = derivePaths(baseConfig({ gogHome: '/base/override' }));
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
      '/base/config/credentials/imap',
    );
  });
});
