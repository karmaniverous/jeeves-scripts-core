/**
 * @module backlog-report
 *
 * Console output for the backlog sorter: priority distribution, change
 * summary, and dry-run top-10 preview. Writes to stdout only.
 */

import type { AgileIssue } from './backlog-sort.js';
import { getPriorityName, PRIORITY_ORDER } from './backlog-sort.js';

/** Print the per-priority issue counts (known priorities first). */
export function printPriorityDistribution(issues: AgileIssue[]): void {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const p = getPriorityName(issue) ?? '(none)';
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  console.log(`Sorting ${String(issues.length)} non-epic issues.\n`);
  console.log('Priority distribution:');
  for (const p of PRIORITY_ORDER) {
    const label = p ?? '(none)';
    const count = counts.get(label) ?? 0;
    if (count > 0) console.log(`  ${label}: ${String(count)}`);
  }
  // Any priorities not in our known list
  for (const [p, c] of counts) {
    if (!PRIORITY_ORDER.includes(p === '(none)' ? null : p)) {
      console.log(`  ${p}: ${String(c)} (unknown — sorted just before Lowest)`);
    }
  }
  console.log();
}

/** Print how many issues change position and where the first change is. */
export function printChangeSummary(
  currentKeys: string[],
  sortedKeys: string[],
): void {
  let firstDiff = -1;
  let diffCount = 0;
  for (let i = 0; i < currentKeys.length; i++) {
    if (currentKeys[i] !== sortedKeys[i]) {
      if (firstDiff === -1) firstDiff = i;
      diffCount++;
    }
  }
  console.log(
    `${String(diffCount)} of ${String(currentKeys.length)} issues will change position (first diff at rank ${String(firstDiff + 1)}).\n`,
  );
}

/** Print the dry-run preview of the new top 10. */
export function printTopPreview(sorted: AgileIssue[]): void {
  console.log('[dry-run] Preview of new top-10:');
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const s = sorted[i];
    const p = getPriorityName(s) ?? '(none)';
    console.log(
      `  ${String(i + 1)}. ${s.key} [${p}] ${s.fields.summary ?? ''}`,
    );
  }
  console.log();
}
