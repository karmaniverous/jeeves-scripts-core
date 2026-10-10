#!/usr/bin/env tsx
/**
 * @module sync-issues
 *
 * Polling sync for Linear issues — scheduled runner job.
 *
 * Reads the last-sync cursor from runner state, fetches all issues
 * updated since that timestamp via the Linear GraphQL API, and upserts
 * each issue into the local archive with reverse-diff history.
 *
 * Scheduled via `jobs/linear.json` (every 23 minutes). Can also be
 * run manually: `jeeves-scripts run linear-sync-issues`
 */

import path from 'node:path';

import { nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getBasePathForLinear } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { upsertEntity } from '../lib/entity-store.js';
import { loadConfig, paginateIssues, sleepMs } from './lib/linear-client.js';

const DOMAIN_DIR = path.join(getBasePathForLinear(), 'linear');
const RATE_LIMIT_MS = 200;
const STATE_NS = 'linear';
const STATE_KEY = 'sync-issues-cursor';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch {
    console.log(
      `[skip] Linear config not found at ${constants().LINEAR_CONFIG_PATH}`,
    );
    return;
  }

  const client = getRunnerClient();

  try {
    const cursor = client.getState(STATE_NS, STATE_KEY) ?? undefined;

    console.log(`[sync-issues] start ${nowIso()} cursor=${cursor ?? '(none)'}`);

    let latestUpdatedAt: string | null = null;
    let upserted = 0;
    let failed = 0;

    for await (const issue of paginateIssues(config, undefined, cursor)) {
      const identifier = issue.identifier as string | undefined;
      if (!identifier) {
        console.error('[sync-issues] issue missing identifier, skipping');
        failed++;
        continue;
      }

      try {
        const now = nowIso();
        upsertEntity(
          DOMAIN_DIR,
          'issue',
          identifier,
          issue,
          now,
          constants().LINEAR_MAX_HISTORY,
        );
        upserted++;

        const updatedAt = issue.updatedAt as string | undefined;
        if (updatedAt) {
          if (!latestUpdatedAt || updatedAt > latestUpdatedAt) {
            latestUpdatedAt = updatedAt;
          }
        }
      } catch (e) {
        failed++;
        console.error(
          `[sync-issues] error ${identifier}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      await sleepMs(RATE_LIMIT_MS);
    }

    if (latestUpdatedAt) {
      client.setState(STATE_NS, STATE_KEY, latestUpdatedAt);
      console.log(`[sync-issues] cursor → ${latestUpdatedAt}`);
    }

    console.log(
      `[sync-issues] end ${nowIso()} — upserted=${String(upserted)} failed=${String(failed)}`,
    );

    if (failed > 0) process.exit(1);
  } finally {
    client.close();
  }
}

runScript('linear/sync-issues', () => {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
