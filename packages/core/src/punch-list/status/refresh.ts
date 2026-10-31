/**
 * @module punch-list/status/refresh
 *
 * Apply gathered milestone facts to the punch list: TODO
 * milestones whose issues are all done move to Done with their releases
 * and install status; Done milestones with a reopened issue go back to
 * TODO; every block's generated status lines are refreshed. Pure.
 */

import {
  isDone,
  issuesLine,
  type MilestoneFacts,
  releasesLine,
  releasesSummary,
} from '../github/facts.js';
import {
  allInstalled,
  type InstallCheck,
  INSTALLED_OK,
  installedLine,
} from '../github/install.js';
import type { Milestone, PunchList } from '../model/types.js';

export interface MilestoneUpdate {
  facts: MilestoneFacts;
  install: InstallCheck[];
}

/** Milestone transitions worth a Slack post. */
export interface Transitions {
  done: { slug: string; releases: string }[];
  installed: string[];
  reopened: string[];
}

const doneStatus = (u: MilestoneUpdate): string[] => [
  issuesLine(u.facts),
  releasesLine(u.facts),
  installedLine(u.install),
];

/** Refresh every TODO and Done milestone that has an update. */
export const refreshMilestones = (
  list: PunchList,
  updates: ReadonlyMap<string, MilestoneUpdate>,
): { list: PunchList; transitions: Transitions } => {
  const transitions: Transitions = { done: [], installed: [], reopened: [] };
  const todo: Milestone[] = [];
  const done: Milestone[] = [];
  for (const m of list.todo) {
    const u = updates.get(m.slug);
    if (!u) todo.push(m);
    else if (isDone(u.facts)) {
      const status = doneStatus(u);
      done.push({ ...m, status, integrated: false });
      transitions.done.push({
        slug: m.slug,
        releases: releasesSummary(u.facts),
      });
      if (allInstalled(u.install)) transitions.installed.push(m.slug);
    } else todo.push({ ...m, status: [issuesLine(u.facts)] });
  }
  for (const m of list.done) {
    const u = updates.get(m.slug);
    if (!u) done.push(m);
    else if (!isDone(u.facts)) {
      todo.push({
        slug: m.slug,
        title: m.title,
        body: m.body,
        status: [issuesLine(u.facts)],
      });
      transitions.reopened.push(m.slug);
    } else {
      const status = doneStatus(u);
      if (!m.status.includes(INSTALLED_OK) && status.includes(INSTALLED_OK)) {
        transitions.installed.push(m.slug);
      }
      done.push({ ...m, status });
    }
  }
  return { list: { ...list, todo, done }, transitions };
};

/** Whether any transition happened. */
export const anyTransitions = (t: Transitions): boolean =>
  t.done.length + t.installed.length + t.reopened.length > 0;
