#!/usr/bin/env tsx
/**
 * @module poll-collabs
 *
 * Poll GitHub repos and invitations, enqueuing items that need bot access.
 *
 * Called by the jeeves-runner scheduler. Lists repos owned by
 * constants().GH_ACCOUNT and pending invitations for constants().GH_BOT_USER, then enqueues
 * new or updated repos into the gh-collabs queue for drain-collabs
 * to process.
 */

import fs from 'node:fs';

import { getArg, nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { constants } from '../lib/constants.js';
import { gh, setupGhConfig } from '../lib/gh.js';

setupGhConfig();

function main(): void {
  if (!fs.existsSync(constants().GH_CONFIG_DIR)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  const argv = process.argv.slice(2);
  const owner = getArg(argv, '--owner', constants().GH_ACCOUNT);
  const botUser = getArg(argv, '--botUser', constants().GH_BOT_USER);
  const client = getRunnerClient();
  const stateJson = client.getState('gh-collabs', 'poll-state');
  const state = stateJson
    ? (JSON.parse(stateJson) as { lastRepoUpdatedAt: string | null })
    : { lastRepoUpdatedAt: null };

  let queued = 0;

  try {
    gh(['auth', 'switch', '-u', owner]);
    let page = 1;
    const repos: Array<{
      full_name: string;
      updated_at: string;
      archived: boolean;
    }> = [];
    for (;;) {
      const result = gh(
        [
          'api',
          '-X',
          'GET',
          `/user/repos?per_page=100&page=${String(page)}&type=owner&sort=updated&direction=desc`,
        ],
        { json: true },
      );
      const batch =
        result.out.length > 0
          ? (JSON.parse(result.out) as Array<{
              full_name: string;
              updated_at: string;
              archived: boolean;
            }>)
          : [];
      if (batch.length === 0) break;
      repos.push(...batch);
      if (batch.length < 100) break;
      page++;
    }

    const target = repos.filter((r) => !r.archived);
    const cutoff = state.lastRepoUpdatedAt;
    for (const r of target) {
      if (cutoff && r.updated_at <= cutoff) continue;
      const itemId = client.enqueue('gh-collabs', {
        kind: 'repo',
        full_name: r.full_name,
        permission: 'push',
        ts: nowIso(),
      });
      if (itemId !== -1) queued++;
    }

    const maxUpdated = target[0]?.updated_at;
    if (maxUpdated) {
      state.lastRepoUpdatedAt = maxUpdated;
      client.setState('gh-collabs', 'poll-state', JSON.stringify(state));
    }

    // Poll invitations as bot
    gh(['auth', 'switch', '-u', botUser]);
    page = 1;
    for (;;) {
      const result = gh(
        [
          'api',
          '-X',
          'GET',
          `/user/repository_invitations?per_page=100&page=${String(page)}`,
        ],
        { json: true },
      );
      const inv =
        result.out.length > 0
          ? (JSON.parse(result.out) as Array<{
              id?: number;
              repository?: { full_name?: string };
            }>)
          : [];
      if (inv.length === 0) break;
      for (const i of inv) {
        if (i.id) {
          const itemId = client.enqueue('gh-collabs', {
            kind: 'invite',
            id: i.id,
            repo: i.repository?.full_name,
            ts: nowIso(),
          });
          if (itemId !== -1) queued++;
        }
      }
      if (inv.length < 100) break;
      page++;
    }
    console.log(`[poll-collabs] queued ${String(queued)} items`);
  } finally {
    client.close();
  }
}

runScript('github/poll-collabs', main);
