import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';
import { constants } from './constants.js';

let dir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[CONFIG_PATH_ENV];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'constants-'));
  const configPath = path.join(dir, 'jeeves-scripts.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instance: { name: 'acme', baseDir: dir },
      siloRouting: { silos: { tcs: { basePath: path.join(dir, 'tcs') } } },
      integrations: {
        x: {
          accounts: {
            main: {},
            ty: { silo: 'tcs', relativePath: 'x/ty' },
          },
        },
      },
    }),
  );
  process.env[CONFIG_PATH_ENV] = configPath;
  resetConfig();
});

afterEach(() => {
  process.env[CONFIG_PATH_ENV] = savedEnv;
  resetConfig();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('constants()', () => {
  it('derives paths from the loaded config', () => {
    const c = constants();
    expect(c.INSTANCE_NAME).toBe('acme');
    expect(c.CONTENT_DIR).toBe(path.join(dir, 'content'));
    expect(c.GITHUB_REGISTRY_PATH).toBe(
      path.join(dir, 'content', 'github', 'registry.json'),
    );
    expect(c.PIPELINE_CONFIG_PATH).toBe(path.join(dir, 'jeeves-scripts.json'));
  });

  it('resolves each X account through its silo, defaulting to x/<handle> in the default silo', () => {
    expect(constants().X_ACCOUNTS).toEqual({
      main: path.join(dir, 'content', 'x', 'main'),
      ty: path.join(dir, 'tcs', 'x', 'ty'),
    });
  });

  it("points at core's own spawn-worker and shipped rate card seed", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const c = constants();
    expect(c.SPAWN_WORKER_PATH).toBe(path.join(here, 'spawn-worker.ts'));
    expect(c.TOKEN_RATES_SEED_PATH).toBe(
      path.resolve(here, '../../config/token-rates.seed.json'),
    );
    expect(fs.existsSync(c.TOKEN_RATES_SEED_PATH)).toBe(true);
  });
});
