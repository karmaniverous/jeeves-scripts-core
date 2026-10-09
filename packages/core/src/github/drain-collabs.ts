#!/usr/bin/env tsx
/**
 * @module drain-collabs
 *
 * Drain the gh-collabs queue, adding bot as collaborator and accepting invitations.
 *
 * Called by the jeeves-runner scheduler. Dequeues items enqueued by
 * poll-collabs, switches between constants().GH_ACCOUNT (to add collaborators)
 * and constants().GH_BOT_USER (to accept invitations) as needed.
 */

import fs from 'node:fs';

import { getArg, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { constants } from '../lib/constants.js';
import { gh, setupGhConfig } from '../lib/gh.js';

setupGhConfig();

interface CollabItem {
  kind: 'repo' | 'invite';
  full_name?: string;
  permission?: string;
  id?: number;
}

function main(): void {
  if (!fs.existsSync(constants().GH_CONFIG_DIR)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  const argv = process.argv.slice(2);
  const owner = getArg(argv, '--owner', constants().GH_ACCOUNT);
  const botUser = getArg(argv, '--botUser', constants().GH_BOT_USER);
  const maxItems = Number(getArg(argv, '--maxItems', '50'));
  const client = getRunnerClient();

  try {
    const items = client.dequeue('gh-collabs', maxItems);
    let processed = 0;

    for (const { id, payload } of items) {
      const item = payload as CollabItem;
      try {
        if (item.kind === 'repo') {
          gh(['auth', 'switch', '-u', owner]);
          const repo = item.full_name!;
          const perm = item.permission || 'push';
          const res = gh(
            [
              'api',
              '-X',
              'PUT',
              `repos/${repo}/collaborators/${botUser}`,
              '-f',
              `permission=${perm}`,
            ],
            { allowFail: true },
          );
          if (!res.ok) throw new Error(res.err || res.out || 'unknown error');
          client.done(id);
          processed++;
          continue;
        }

        if ((item.kind as string) === 'invite') {
          gh(['auth', 'switch', '-u', botUser]);
          const inviteId = item.id!;
          const res = gh(
            [
              'api',
              '-X',
              'PATCH',
              `user/repository_invitations/${String(inviteId)}`,
            ],
            { allowFail: true },
          );
          if (!res.ok) throw new Error(res.err || res.out || 'unknown error');
          client.done(id);
          processed++;
          continue;
        }

        client.done(id);
        processed++;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        client.fail(id, errorMsg);
        processed++;
      }
    }
    console.log(`[drain-collabs] processed ${String(processed)} items`);
  } finally {
    client.close();
  }
}

runScript('github/drain-collabs', main);
