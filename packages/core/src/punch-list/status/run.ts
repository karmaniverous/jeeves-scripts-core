/**
 * @module punch-list/status/run
 *
 * The status checker's body (`punch-list-refresh-status`):
 * apply ticks, refresh TODO and Done milestones from GitHub and the
 * install map, write today's file, and post milestone transitions.
 * Without `live` it logs the file and the post instead.
 *
 * Side effects: GitHub reads, one file write, Slack posts (new transitions
 * plus any left unposted by an earlier run; see `pending.ts`).
 */

import { type PunchListConfig, scannedRepos } from '../config.js';
import { gatherFacts, isDone } from '../github/facts.js';
import { checkInstall, type InstallEnv } from '../github/install.js';
import type { GitHubPort } from '../github/port.js';
import { transitionMessage } from '../messages.js';
import { anyMoves, applyTicks } from '../model/transitions.js';
import { type JobDeps, todayFor } from '../runtime.js';
import { loadToday, updateToday } from '../store.js';
import { postQueued, readPending } from './pending.js';
import {
  anyTransitions,
  type MilestoneUpdate,
  refreshMilestones,
} from './refresh.js';

/** How `punch-list-refresh-status` runs. */
export interface StatusFlags {
  /** Write the file and post (default: dry run). */
  live: boolean;
}

/** The status checker's dependencies. */
export interface StatusDeps extends JobDeps {
  github: GitHubPort;
  install: InstallEnv;
}

/** Gather an update for every TODO and Done milestone in `slugs`. */
const gatherUpdates = (
  config: PunchListConfig,
  slugs: string[],
  deps: StatusDeps,
): Map<string, MilestoneUpdate> =>
  new Map(
    slugs.map((slug) => {
      const facts = gatherFacts(
        deps.github,
        slug,
        scannedRepos(config),
        config.scriptsRepo.repo,
      );
      const install = isDone(facts)
        ? checkInstall(
            facts,
            config.installMap,
            config.scriptsRepo.clone,
            deps.install,
          )
        : [];
      return [slug, { facts, install }];
    }),
  );

/** Run the status checker once. */
export const runStatus = async (
  config: PunchListConfig,
  { live }: StatusFlags,
  deps: StatusDeps,
): Promise<void> => {
  const dryRun = !live;
  const today = todayFor(config, deps.now());
  const current = loadToday(today.store).list;
  const slugs = [
    ...current.todo,
    ...current.done,
    ...current.integrated.filter((m) => m.integrated === false),
  ].map((m) => m.slug);
  const updates = gatherUpdates(config, slugs, deps);

  const res = updateToday({ ...today.store, dryRun }, (list) => {
    const ticked = applyTicks(list, today.day);
    const refreshed = refreshMilestones(ticked.list, updates);
    return {
      list: refreshed.list,
      result: { moves: ticked.moves, transitions: refreshed.transitions },
    };
  });
  const { moves, transitions } = res.result;
  const fileState = res.changed
    ? dryRun
      ? 'would change'
      : 'written'
    : 'unchanged';
  deps.log(
    `${today.day}: ${String(slugs.length)} milestone(s) checked; ${anyMoves(moves) ? 'ticks applied; ' : ''}file ${fileState}`,
  );
  if (dryRun && res.changed) deps.log(res.content);

  const fresh = anyTransitions(transitions)
    ? [transitionMessage(transitions, today.url)]
    : [];
  if (dryRun) {
    for (const m of fresh)
      deps.log(`[dry-run] would post to ${config.slack.channel}:\n${m}`);
    return;
  }
  const queued = readPending(config.pendingFile).length;
  if (!fresh.length && !queued) return;
  if (queued) deps.log(`retrying ${String(queued)} unposted notification(s)`);
  const slack = deps.slack();
  await postQueued(config.pendingFile, fresh, (m) =>
    slack.post(config.slack.channel, m),
  );
};
