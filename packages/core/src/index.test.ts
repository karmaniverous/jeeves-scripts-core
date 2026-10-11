import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_PATH_ENV } from './config/loader.js';

describe('package entry point', () => {
  const saved = process.env[CONFIG_PATH_ENV];

  afterEach(() => {
    process.env[CONFIG_PATH_ENV] = saved;
    vi.resetModules();
  });

  it('reads no config on import; the first getter call loads it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-'));
    const configPath = path.join(dir, 'jeeves-scripts.json');
    process.env[CONFIG_PATH_ENV] = configPath;
    vi.resetModules();

    const core = await import('./index.js');
    expect(() => core.paths()).toThrow(configPath);

    fs.writeFileSync(
      configPath,
      JSON.stringify({ instance: { name: 'x', baseDir: dir } }),
    );
    core.resetConfig();
    expect(core.paths().contentDir).toBe(path.join(dir, 'content'));
    expect(core.siloPath(undefined, ['digest', 'TASK.md'])).toBe(
      path.join(dir, 'content', 'digest', 'TASK.md'),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    // A fresh import of the whole root export is slow under a parallel run.
  }, 30_000);

  it('exports the design §3 utilities', async () => {
    const core: Record<string, unknown> = await import('./index.js');
    const utilities = [
      'constants',
      'defineJob',
      'isJobModule',
      'definePlugin',
      'override',
      'localConfig',
      'isPlugin',
      'isJobOverride',
      'taskFileDispatcher',
      'dispatchTaskFile',
      'resolveTaskFile',
      'digestTimeZone',
      'withDateContext',
      'requireTimeZone',
      'dayOfWeek',
      'formatDate',
      'relativeDays',
      'dispatchWithSlack',
      'parseWorkerSlackConfig',
      'componentConfigPath',
      'readComponentConfig',
      'runnerConfig',
      'runnerUrl',
      'triggerRunnerJob',
      'metaConfig',
      'metaUrl',
      'openclawStateDirs',
      'openclawConfigPaths',
      'findInOpenclawConfig',
      'slackBotToken',
      'slackBotTokens',
      'gatewayToken',
      'gatewayPort',
      'gh',
      'ghJson',
      'ghApi',
      'setupGhConfig',
      'getTokenMetrics',
      'convertDocxToMd',
      'convertPdfToMd',
    ];
    expect(
      utilities.filter((name) => typeof core[name] !== 'function'),
    ).toEqual([]);
    expect(core.DIGEST_TIMEZONE_REF).toBe('digest.timezone');
  }, 30_000);
});

describe('package exports map', () => {
  it('publishes only the root API, the CLI and package files (no wildcard)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
      dependencies: Record<string, string>;
    };
    // The CLI imports the instance plugin with tsx at run time.
    expect(pkg.dependencies).toHaveProperty('tsx');
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.',
      './cli',
      './config/*',
      './guides/*',
      './package.json',
      './presets/*',
      './presets/*.js',
      './schema/*',
      './skills/*',
    ]);
  });
});
