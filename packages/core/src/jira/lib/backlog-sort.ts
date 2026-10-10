/**
 * @module backlog-sort
 *
 * Pure backlog sorting and re-rank planning (no I/O). Stable-sorts issues by
 * priority group and plans the batched Jira Agile rank calls to apply it.
 */

/** Jira Agile API max issues per rank call. */
export const RANK_BATCH_SIZE = 50;

/**
 * Priority sort order. Lower index = higher on board.
 * Issues with no priority (null) sort to top per requirements.
 */
export const PRIORITY_ORDER: (string | null)[] = [
  null, // No priority → top
  'Highest',
  'High',
  'Medium',
  'Low',
  'Lowest',
];

/** Minimal Agile backlog issue shape used by the sorter. */
export interface AgileIssue {
  id: string;
  key: string;
  fields: {
    priority?: { name: string } | null;
    summary?: string;
    issuetype?: { name: string } | null;
    [k: string]: unknown;
  };
}

/** Sort rank for a priority name; unknown priorities sit between Low and Lowest. */
export function priorityRank(priorityName: string | null): number {
  const idx = PRIORITY_ORDER.indexOf(priorityName);
  return idx >= 0 ? idx : PRIORITY_ORDER.length - 1.5;
}

/** Priority name of an issue, or null when unset. */
export function getPriorityName(issue: AgileIssue): string | null {
  return issue.fields.priority?.name ?? null;
}

/**
 * Stable-sort issues by priority group.
 * Returns the new order (same issues, possibly reordered).
 */
export function stableSortByPriority(issues: AgileIssue[]): AgileIssue[] {
  const indexed = issues.map((issue, i) => ({ issue, origIdx: i }));
  indexed.sort((a, b) => {
    const pa = priorityRank(getPriorityName(a.issue));
    const pb = priorityRank(getPriorityName(b.issue));
    if (pa !== pb) return pa - pb;
    return a.origIdx - b.origIdx; // stable: preserve original order within group
  });
  return indexed.map((x) => x.issue);
}

/** A single Jira `PUT issue/rank` call plus its dry-run description. */
export interface RankOp {
  body:
    | { issues: string[]; rankAfterIssue: string }
    | { issues: string[]; rankBeforeIssue: string };
  dryRunMessage: string;
}

/**
 * Plan the rank calls that move `sortedKeys` into order at the top of the
 * backlog, anchored on the current first backlog issue.
 */
export function planRerank(
  sortedKeys: string[],
  currentFirstKey: string,
  batchSize: number = RANK_BATCH_SIZE,
): RankOp[] {
  const batches: string[][] = [];
  for (let i = 0; i < sortedKeys.length; i += batchSize) {
    batches.push(sortedKeys.slice(i, i + batchSize));
  }

  const ops: RankOp[] = [];

  // Top-down: establish batch 0's internal order, then append each
  // subsequent batch after the previous one.
  let previous: string[] | undefined;
  for (const [b, batch] of batches.entries()) {
    const prev = previous;
    previous = batch;
    // Batches are non-empty slices, so the previous one has a last key.
    const anchor = prev?.at(-1);
    if (anchor !== undefined) {
      ops.push({
        body: { issues: batch, rankAfterIssue: anchor },
        dryRunMessage: `[dry-run] Would rank ${String(batch.length)} issues (batch ${String(b)}) after ${anchor}`,
      });
      continue;
    }

    if (!batch.includes(currentFirstKey)) {
      // Anchor is NOT in batch — safe to rank the whole batch before it.
      ops.push({
        body: { issues: batch, rankBeforeIssue: currentFirstKey },
        dryRunMessage: `[dry-run] Would rank ${String(batch.length)} issues (batch ${String(b)}) before ${currentFirstKey}`,
      });
      continue;
    }

    // Anchor is in batch — we can't rank before it; establish internal
    // order by ranking batch[1:] after batch[0].
    const [head, ...tail] = batch;
    if (head === undefined) continue;
    if (tail.length > 0) {
      ops.push({
        body: { issues: tail, rankAfterIssue: head },
        dryRunMessage: `[dry-run] Would rank ${String(tail.length)} issues (batch ${String(b)} tail) after ${head}`,
      });
    }
    // If batch[0] is not currently the first backlog issue, move it to top.
    if (currentFirstKey !== head) {
      ops.push({
        body: { issues: [head], rankBeforeIssue: currentFirstKey },
        dryRunMessage: `[dry-run] Would rank ${head} before ${currentFirstKey}`,
      });
    }
  }

  return ops;
}
