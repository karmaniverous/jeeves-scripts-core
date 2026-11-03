/**
 * @module admin/skill-review/reconcile
 *
 * Square the proposals the review saw with the Workshop as it is when the
 * summary is posted, so the post lists only what is still actionable:
 * reviewed proposals still pending with the same draft, ones revised since
 * (their recommendation is for the earlier draft), ones created since, and
 * a count of ones decided since. When the refresh failed, or the refreshed
 * list hit the list limit (a missing id may only be beyond the cap), the
 * reviewed proposals are kept as they were and the result says the post
 * reflects the review's snapshot. Pure.
 */

import type { PendingProposal } from './proposals.js';
import type { ReviewedProposal } from './slack-post.js';

/** What reconciliation needs from a proposal. */
export type ProposalState = Pick<
  PendingProposal,
  'id' | 'skillName' | 'kind' | 'draftHash' | 'updatedAt'
>;

/** The post's view of the proposals. */
export interface Reconciled {
  /** Reviewed and unchanged: their recommendations stand. */
  current: ReviewedProposal[];
  /** Reviewed, but the draft changed since. */
  revised: ReviewedProposal[];
  /** Created after the review ran. */
  added: ReviewedProposal[];
  /** Reviewed, but no longer pending (applied, rejected, ...). */
  decided: number;
  /** The refresh failed or was capped: `current` is the review's snapshot. */
  snapshot: boolean;
}

const changed = (was: ProposalState, now: ProposalState): boolean =>
  was.draftHash !== now.draftHash || was.updatedAt !== now.updatedAt;

/**
 * Reconcile the reviewed proposals with the current pending list.
 *
 * @param reviewed - The proposals the review saw, in review order.
 * @param now - The pending proposals now, or `undefined` if the refresh
 *   failed.
 * @param listLimit - The most proposals one listing returns.
 * @returns The post's view.
 */
export function reconcile(
  reviewed: readonly ProposalState[],
  now: readonly ProposalState[] | undefined,
  listLimit: number,
): Reconciled {
  if (!now)
    return {
      current: [...reviewed],
      revised: [],
      added: [],
      decided: 0,
      snapshot: true,
    };
  const capped = now.length >= listLimit;
  const byId = new Map(now.map((p) => [p.id, p]));
  const seen = new Set(reviewed.map((p) => p.id));
  const result: Reconciled = {
    current: [],
    revised: [],
    added: now.filter((p) => !seen.has(p.id)),
    decided: 0,
    snapshot: capped,
  };
  for (const p of reviewed) {
    const latest = byId.get(p.id);
    if (!latest) {
      if (capped) result.current.push(p);
      else result.decided += 1;
    } else if (changed(p, latest)) result.revised.push(latest);
    else result.current.push(p);
  }
  return result;
}
