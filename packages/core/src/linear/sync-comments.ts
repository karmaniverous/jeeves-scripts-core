#!/usr/bin/env tsx
/**
 * @module sync-comments
 *
 * Polling sync for Linear comments — scheduled runner job.
 *
 * Reads the last-sync cursor from runner state, fetches all comments
 * updated since that timestamp via the Linear GraphQL API, and upserts
 * each comment into the local archive with reverse-diff history.
 *
 * Scheduled via `jobs/linear.json` (every 29 minutes). Can also be
 * run manually: `tsx src/linear/sync-comments.ts`
 */

import path from 'node:path';

import { nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getBasePathForLinear } from '../config/index.js';
import { constants } from '../lib/constants.js';
import { upsertEntity } from '../lib/entity-store.js';
import {
  enrichComment,
  loadConfig,
  paginateComments,
  sleepMs,
} from './lib/linear-client.js';

const DOMAIN_DIR = path.join(getBasePathForLinear(), 'linear');
const RATE_LIMIT_MS = 200;
const STATE_NS = 'linear';
const STATE_KEY = 'sync-comments-cursor';

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

    console.log(
      `[sync-comments] start ${nowIso()} cursor=${cursor ?? '(none)'}`,
    );

    let latestUpdatedAt: string | null = null;
    let upserted = 0;
    let failed = 0;

    for await (const comment of paginateComments(config, cursor)) {
      const id = comment.id as string | undefined;
      if (!id) {
        console.error('[sync-comments] comment missing id, skipping');
        failed++;
        continue;
      }

      try {
        const current = enrichComment(comment);

        const now = nowIso();
        upsertEntity(
          DOMAIN_DIR,
          'comment',
          id,
          current,
          now,
          constants().LINEAR_MAX_HISTORY,
        );
        upserted++;

        const updatedAt = comment.updatedAt as string | undefined;
        if (updatedAt) {
          if (!latestUpdatedAt || updatedAt > latestUpdatedAt) {
            latestUpdatedAt = updatedAt;
          }
        }
      } catch (e) {
        failed++;
        console.error(
          `[sync-comments] error comment/${id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      await sleepMs(RATE_LIMIT_MS);
    }

    if (latestUpdatedAt) {
      client.setState(STATE_NS, STATE_KEY, latestUpdatedAt);
      console.log(`[sync-comments] cursor → ${latestUpdatedAt}`);
    }

    console.log(
      `[sync-comments] end ${nowIso()} — upserted=${String(upserted)} failed=${String(failed)}`,
    );

    if (failed > 0) process.exit(1);
  } finally {
    client.close();
  }
}

runScript('linear/sync-comments', () => {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
