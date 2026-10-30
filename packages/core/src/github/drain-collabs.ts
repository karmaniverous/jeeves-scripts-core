/**
 * @module drain-collabs
 *
 * Drain the gh-collabs queue, adding bot as collaborator and accepting invitations.
 *
 * Called by the jeeves-runner scheduler. Dequeues items enqueued by
 * poll-collabs, switches between the gh account (to add collaborators)
 * and the bot user (to accept invitations) as needed.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import { argValue, type ParsedArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import {
  collabArgs,
  collabFlags,
  GhAccountMismatchError,
  ghReady,
  type GitHubJobDeps,
  githubJobDeps,
  verifyActingAccount,
} from './lib/github-deps.js';

interface CollabItem {
  kind: 'repo' | 'invite';
  full_name?: string;
  permission?: string;
  id?: number;
}

/** The flags `github-drain-collabs` accepts. */
export const drainCollabsFlags = {
  ...collabFlags,
  maxItems: argValue('--maxItems', '50', {
    description: 'Invitations to process',
  }),
};

/** Run the job. */
export function drainCollabs(
  flags: Partial<ParsedArgs<typeof drainCollabsFlags>>,
  deps: GitHubJobDeps,
): void {
  if (!ghReady(deps)) return;

  const { owner, botUser } = collabArgs(flags, deps);
  const maxItems = Number(flags.maxItems ?? '50');
  const client = deps.runner();

  try {
    let processed = 0;

    // One item at a time: dequeue() spends an attempt, so a batch claimed up
    // front would lose whatever an account mismatch stops before reaching
    // (#61 review).
    while (processed < maxItems) {
      const [next] = client.dequeue('gh-collabs', 1);
      if (!next) break;
      const { id, payload } = next;
      const item = payload as CollabItem;
      try {
        if (item.kind === 'repo') {
          deps.gh(['auth', 'switch', '-u', owner]);
          verifyActingAccount(deps, owner);
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
          verifyActingAccount(deps, botUser);
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
        client.fail(id, getErrorMessage(e));
        processed++;
        // Acting as the wrong account: stop before anything else is written.
        // dequeue() spent this item's only attempt, so queue it again for the
        // next run; the items not yet dequeued stay pending (#61 reviews).
        if (e instanceof GhAccountMismatchError) {
          client.enqueue('gh-collabs', payload);
          throw e;
        }
      }
    }
    console.log(`[drain-collabs] processed ${String(processed)} items`);
  } finally {
    client.close();
  }
}

export default defineRunnable({
  id: 'github-drain-collabs',
  domain: 'github',
  name: 'github/drain-collabs',
  flags: drainCollabsFlags,
  run: ({ flags }) => {
    drainCollabs(flags, githubJobDeps());
  },
});
