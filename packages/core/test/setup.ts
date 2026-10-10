/**
 * Vitest setup for `@karmaniverous/jeeves-scripts-core`.
 *
 * Code copied from jeeves-scripts-template (Decision 32) reads instance
 * values through `constants()` and the config getters, which need a loaded
 * `jeeves-scripts.json`. This writes a test config that reproduces the
 * template's placeholder constants (base dir `/opt/jeeves`, Qdrant on
 * localhost) to a temp file and points `JEEVES_SCRIPTS_CONFIG` at it, so
 * the copied tests see the same values they were written against. Tests
 * that load their own config call `resetConfig()` and pass `configPath`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONFIG_PATH_ENV } from '../src/config/loader.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-test-config-'));
const configPath = path.join(dir, 'jeeves-scripts.json');

fs.writeFileSync(
  configPath,
  JSON.stringify({
    instance: { name: 'template', baseDir: '/opt/jeeves' },
    integrations: {
      qdrant: { apiUrl: 'http://localhost:6333', serviceName: 'qdrant' },
    },
    pipeline: {
      accounts: [],
      buckets: { domains: [], priority: [] },
      refs: {},
      emailConfig: {
        reportOnly: true,
        digest: { slackChannelId: '' },
      },
    },
  }),
);

process.env[CONFIG_PATH_ENV] = configPath;
