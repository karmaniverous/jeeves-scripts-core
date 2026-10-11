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
});
