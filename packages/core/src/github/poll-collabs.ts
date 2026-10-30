/**
 * @module poll-collabs
 *
 * Poll GitHub repos and invitations, enqueuing items that need bot access.
 *
 * Called by the jeeves-runner scheduler. Lists repos owned by
 * the gh account and pending invitations for the bot user, then enqueues
 * new or updated repos into the gh-collabs queue for drain-collabs
 * to process.
 */

import type { ParsedArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import {
  collabArgs,
  collabFlags,
  ghReady,
  type GitHubJobDeps,
  githubJobDeps,
  verifyActingAccount,
} from './lib/github-deps.js';

/** Run the job. */
export function pollCollabs(
  flags: Partial<ParsedArgs<typeof collabFlags>>,
  deps: GitHubJobDeps,
): void {
  if (!ghReady(deps)) return;

  const { owner, botUser } = collabArgs(flags, deps);
  const client = deps.runner();
  const stateJson = client.getState('gh-collabs', 'poll-state');
  const state = stateJson
    ? (JSON.parse(stateJson) as { lastRepoUpdatedAt: string | null })
    : { lastRepoUpdatedAt: null };

  let queued = 0;

  try {
    deps.gh(['auth', 'switch', '-u', owner]);
    verifyActingAccount(deps, owner);
    let page = 1;
    const repos: {
      full_name: string;
      updated_at: string;
      archived: boolean;
    }[] = [];
    for (;;) {
      const result = deps.gh([
        'api',
        '-X',
        'GET',
        `/user/repos?per_page=100&page=${String(page)}&type=owner&sort=updated&direction=desc`,
      ]);
      const batch =
        result.out.length > 0
          ? (JSON.parse(result.out) as {
              full_name: string;
              updated_at: string;
              archived: boolean;
            }[])
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
        ts: deps.now(),
      });
      if (itemId !== -1) queued++;
    }

    const maxUpdated = target[0]?.updated_at;
    if (maxUpdated) {
      state.lastRepoUpdatedAt = maxUpdated;
      client.setState('gh-collabs', 'poll-state', JSON.stringify(state));
    }

    // Poll invitations as bot
    deps.gh(['auth', 'switch', '-u', botUser]);
    verifyActingAccount(deps, botUser);
    page = 1;
    for (;;) {
      const result = deps.gh([
        'api',
        '-X',
        'GET',
        `/user/repository_invitations?per_page=100&page=${String(page)}`,
      ]);
      const inv =
        result.out.length > 0
          ? (JSON.parse(result.out) as {
              id?: number;
              repository?: { full_name?: string };
            }[])
          : [];
      if (inv.length === 0) break;
      for (const i of inv) {
        if (i.id) {
          const itemId = client.enqueue('gh-collabs', {
            kind: 'invite',
            id: i.id,
            repo: i.repository?.full_name,
            ts: deps.now(),
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

export default defineRunnable({
  id: 'github-poll-collabs',
  domain: 'github',
  name: 'github/poll-collabs',
  flags: collabFlags,
  run: ({ flags }) => {
    pollCollabs(flags, githubJobDeps());
  },
});
