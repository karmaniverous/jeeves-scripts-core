/**
 * @module drain-collabs
 *
 * Drain the gh-collabs queue, adding bot as collaborator and accepting invitations.
 *
 * Called by the jeeves-runner scheduler. Dequeues items enqueued by
 * poll-collabs, switches between the gh account (to add collaborators)
 * and the bot user (to accept invitations) as needed.
 */

import { defineJob } from '../jobs/define-job.js';
import { argValue, parseRunnableArgs } from '../lib/args.js';
import {
  collabArgs,
  ghReady,
  type GitHubJobDeps,
  githubJobDeps,
} from './lib/github-deps.js';

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
  if (!ghReady(deps)) return;

  const { owner, botUser } = collabArgs(args, deps);
  const maxItems = Number(
    parseRunnableArgs(args, { maxItems: argValue('--maxItems', '50') })
      .maxItems,
  );
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
