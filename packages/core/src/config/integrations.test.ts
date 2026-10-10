import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveIntegrations } from './integrations.js';
import { type Config } from './schema.js';

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrations-'));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

/** Write the watcher's config under `{baseDir}/config`. */
const writeWatcherConfig = (content: unknown) => {
  const dir = path.join(baseDir, 'config', 'jeeves-watcher');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(content));
};

const baseConfig = (
  integrations: Partial<Config['integrations']> = {},
): Config => ({
  instance: { name: 'test', baseDir },
  paths: {},
  integrations: {
    gh: {},
    qdrant: {},
    gog: {},
    notion: {},
    jira: {},
    linear: {},
    x: { accounts: {} },
    ...integrations,
  },
  siloRouting: { silos: {} },
  slack: { channels: {} },
  people: {},
  jobs: {},
  extensions: {},
});

describe('deriveIntegrations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies defaults when nothing is configured', () => {
    const result = deriveIntegrations(baseConfig());
    expect(result.gh.bin).toBe('gh');
    expect(result.qdrant.apiUrl).toBe('http://localhost:6333');
    expect(result.qdrant.serviceName).toBe('qdrant');
    expect(result.gog.bin).toBe('gog');
    expect(result.notion.version).toBe('2025-09-03');
    expect(result.jira.maxHistory).toBe(50);
    expect(result.linear.maxHistory).toBe(50);
  });

  it('honours configured values (JGS-shaped)', () => {
    const result = deriveIntegrations(
      baseConfig({
        gh: { account: 'karmaniverous', botUser: 'jgs-jeeves' },
        qdrant: { serviceName: 'Qdrant' },
        jira: { siteUrl: 'https://x.atlassian.net', boardId: 6 },
      }),
    );
    expect(result.gh.account).toBe('karmaniverous');
    expect(result.gh.botUser).toBe('jgs-jeeves');
    expect(result.qdrant.serviceName).toBe('Qdrant');
    expect(result.jira.boardId).toBe(6);
  });

  it("defaults the Qdrant URL to the watcher's vectorStore.url", () => {
    writeWatcherConfig({ vectorStore: { url: 'http://watcher:6333' } });
    expect(deriveIntegrations(baseConfig()).qdrant.apiUrl).toBe(
      'http://watcher:6333',
    );
  });

  it('configured qdrant.apiUrl wins over the watcher config', () => {
    writeWatcherConfig({ vectorStore: { url: 'http://watcher:6333' } });
    expect(
      deriveIntegrations(
        baseConfig({ qdrant: { apiUrl: 'http://configured:6333' } }),
      ).qdrant.apiUrl,
    ).toBe('http://configured:6333');
  });

  it('falls back to localhost when the watcher config is unreadable', () => {
    const dir = path.join(baseDir, 'config', 'jeeves-watcher');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), 'not json');
    expect(deriveIntegrations(baseConfig()).qdrant.apiUrl).toBe(
      'http://localhost:6333',
    );
  });

  it('QDRANT_API_URL env wins over configured and default', () => {
    vi.stubEnv('QDRANT_API_URL', 'http://env:6333');
    const result = deriveIntegrations(
      baseConfig({ qdrant: { apiUrl: 'http://configured:6333' } }),
    );
    expect(result.qdrant.apiUrl).toBe('http://env:6333');
  });

  it('GH_CONFIG_DIR env wins over configured and default', () => {
    vi.stubEnv('GH_CONFIG_DIR', '/env/gh-cli');
    const result = deriveIntegrations(
      baseConfig({ gh: { configDir: '/configured/gh-cli' } }),
    );
    expect(result.gh.configDir).toBe('/env/gh-cli');
  });

  it('LINEAR_CONFIG_PATH env wins over configured and default', () => {
    vi.stubEnv('LINEAR_CONFIG_PATH', '/env/linear.json');
    const result = deriveIntegrations(
      baseConfig({ linear: { configPath: '/configured/linear.json' } }),
    );
    expect(result.linear.configPath).toBe('/env/linear.json');
  });

  it('JIRA_BOARD_ID env fills boardId when unconfigured', () => {
    vi.stubEnv('JIRA_BOARD_ID', '6');
    const result = deriveIntegrations(baseConfig());
    expect(result.jira.boardId).toBe(6);
  });

  it('derives jira.apiTokenPath and linear.configPath from credentialsDir', () => {
    const result = deriveIntegrations(baseConfig());
    expect(result.jira.apiTokenPath).toBe(
      path.join(baseDir, 'config', 'credentials', 'atlassian/acli-token.txt'),
    );
    expect(result.linear.configPath).toBe(
      path.join(baseDir, 'config', 'credentials', 'linear.json'),
    );
  });
});
