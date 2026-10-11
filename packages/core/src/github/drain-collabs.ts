/**
 * @module drain-collabs
 *
 * Drain the gh-collabs queue, adding bot as collaborator and accepting invitations.
 *
 * Called by the jeeves-runner scheduler. Dequeues items enqueued by
 * poll-collabs, switches between the gh account (to add collaborators)
 * and the bot user (to accept invitations) as needed.
 */

import fs from 'node:fs';

import { defineJob } from '../jobs/define-job.js';
import { parseRunnableArgs, value } from '../lib/args.js';
import { type GitHubJobDeps, githubJobDeps } from './lib/github-deps.js';

interface CollabItem {
  kind: 'repo' | 'invite';
  full_name?: string;
  permission?: string;
  id?: number;
}

/** Run the job. */
export function drainCollabs(
  args: readonly string[],
  deps: GitHubJobDeps,
): void {
  if (!fs.existsSync(deps.configDir)) {
    console.log('[skip] GitHub CLI config not configured');
    return;
  }

  const {
    owner,
    botUser,
    maxItems: max,
  } = parseRunnableArgs(args, {
    owner: value('--owner', deps.account),
    botUser: value('--botUser', deps.botUser),
    maxItems: value('--maxItems', '50'),
  });
  const maxItems = Number(max);
  const client = deps.runner();

  try {
    const items = client.dequeue('gh-collabs', maxItems);
    let processed = 0;

    for (const { id, payload } of items) {
      const item = payload as CollabItem;
      try {
        if (item.kind === 'repo') {
          deps.gh(['auth', 'switch', '-u', owner]);
          const repo = item.full_name!;
          const perm = item.permission ?? 'push';
          const res = deps.gh(
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
          deps.gh(['auth', 'switch', '-u', botUser]);
          const inviteId = item.id!;
          const res = deps.gh(
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

export default defineJob({
  id: 'github-drain-collabs',
  domain: 'github',
  name: 'github/drain-collabs',
  run: ({ args }) => {
    drainCollabs(args, githubJobDeps());
  },
});
