/**
 * @module lib/people-callers.test-helper
 *
 * Test helper for the people-callers tests: a temp config
 * (`useTempConfig`) with one listed person (Jane Doe, two Slack accounts,
 * two emails). Not built or shipped.
 */

import fs from 'node:fs';

import { useTempConfig } from './temp-config.test-helper.js';

/** The listed person, as callers record her. */
export const JANE = { id: 'jane-doe', name: 'Jane Doe' };

/**
 * Register suite hooks that write the test config (the shared test config
 * plus the `people` block) and pin it; resolves the temp dir lazily.
 */
export const usePeopleConfig = (): (() => string) =>
  useTempConfig({
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
  });

/** Read a JSON file as a record. */
export const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
