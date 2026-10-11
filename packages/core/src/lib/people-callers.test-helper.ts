/**
 * @module lib/people-callers.test-helper
 *
 * Test helper for the people-callers tests: a config with one listed
 * person (Jane Doe, two Slack accounts, two emails) written to a temp dir
 * and pinned through `JEEVES_SCRIPTS_CONFIG` for the suite. Not built or
 * shipped.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll } from 'vitest';

import { CONFIG_PATH_ENV, resetConfig } from '../config/loader.js';

/** The listed person, as callers record her. */
export const JANE = { id: 'jane-doe', name: 'Jane Doe' };

/**
 * Register suite hooks that write the test config (the shared test config
 * plus the `people` block) and pin it; resolves the temp dir lazily.
 */
export const usePeopleConfig = (): (() => string) => {
  let dir = '';
  const savedEnv = process.env[CONFIG_PATH_ENV];

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-callers-'));
    const base = JSON.parse(fs.readFileSync(savedEnv ?? '', 'utf8')) as Record<
      string,
      unknown
    >;
    const configPath = path.join(dir, 'jeeves-scripts.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ...base,
        people: {
          'jane-doe': {
            name: JANE.name,
            emails: ['jane@example.com', 'jane.doe@example.org'],
            accounts: [
              { channel: 'slack', account: 'default', id: 'U0JANE0001' },
              { channel: 'slack', account: 'work', id: 'U0JANE0002' },
            ],
          },
        },
      }),
    );
    process.env[CONFIG_PATH_ENV] = configPath;
    resetConfig();
  });

  afterAll(() => {
    process.env[CONFIG_PATH_ENV] = savedEnv;
    resetConfig();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
};

/** Read a JSON file as a record. */
export const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
