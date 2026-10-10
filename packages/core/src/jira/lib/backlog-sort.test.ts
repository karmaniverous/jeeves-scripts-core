/**
 * Tests for pure backlog sort and re-rank planning.
 */

import { describe, expect, it } from 'vitest';

import type { AgileIssue } from './backlog-sort.js';
import {
  getPriorityName,
  planRerank,
  priorityRank,
  stableSortByPriority,
} from './backlog-sort.js';

const issue = (key: string, priority?: string | null): AgileIssue => ({
  id: key,
  key,
  fields: {
    priority:
      priority === undefined || priority === null ? null : { name: priority },
  },
});

describe('priorityRank', () => {
  it.each([
    [null, 0],
    ['Highest', 1],
    ['High', 2],
    ['Medium', 3],
    ['Low', 4],
    ['Lowest', 5],
    ['Custom', 4.5],
  ])('%s -> %d', (name, rank) => {
    expect(priorityRank(name)).toBe(rank);
  });
});

describe('getPriorityName', () => {
  it('returns null when priority missing', () => {
    expect(getPriorityName(issue('A-1'))).toBeNull();
    expect(getPriorityName(issue('A-2', 'High'))).toBe('High');
  });
});

describe('stableSortByPriority', () => {
  it('groups by priority, none first, preserving order within groups', () => {
    const input = [
      issue('A-1', 'Low'),
      issue('A-2', 'Highest'),
      issue('A-3'),
      issue('A-4', 'Low'),
      issue('A-5', 'Custom'),
      issue('A-6', 'Lowest'),
      issue('A-7', 'Highest'),
      issue('A-8'),
    ];
    expect(stableSortByPriority(input).map((i) => i.key)).toEqual([
      'A-3',
      'A-8',
      'A-2',
      'A-7',
      'A-1',
      'A-4',
      'A-5',
      'A-6',
    ]);
  });

  it('does not mutate input', () => {
    const input = [issue('A-1', 'Low'), issue('A-2', 'High')];
    stableSortByPriority(input);
    expect(input.map((i) => i.key)).toEqual(['A-1', 'A-2']);
  });
});

describe('planRerank', () => {
  it('returns no ops for empty input', () => {
    expect(planRerank([], 'A-1')).toEqual([]);
  });

  it('ranks whole first batch before anchor when anchor not in batch', () => {
    const ops = planRerank(['B', 'C'], 'A', 2);
    expect(ops).toEqual([
      {
        body: { issues: ['B', 'C'], rankBeforeIssue: 'A' },
        dryRunMessage: '[dry-run] Would rank 2 issues (batch 0) before A',
      },
    ]);
  });

  it('orders tail then moves head to top when anchor is inside batch', () => {
    const ops = planRerank(['B', 'A', 'C'], 'A', 3);
    expect(ops.map((o) => o.body)).toEqual([
      { issues: ['A', 'C'], rankAfterIssue: 'B' },
      { issues: ['B'], rankBeforeIssue: 'A' },
    ]);
    expect(ops[0]!.dryRunMessage).toBe(
      '[dry-run] Would rank 2 issues (batch 0 tail) after B',
    );
    expect(ops[1]!.dryRunMessage).toBe('[dry-run] Would rank B before A');
  });

  it('skips head move when head already is the anchor', () => {
    const ops = planRerank(['A', 'B'], 'A', 2);
    expect(ops.map((o) => o.body)).toEqual([
      { issues: ['B'], rankAfterIssue: 'A' },
    ]);
  });

  it('emits no op for single-issue batch equal to anchor', () => {
    expect(planRerank(['A'], 'A', 2)).toEqual([]);
  });

  it('chains subsequent batches after the previous batch tail', () => {
    const ops = planRerank(['A', 'B', 'C', 'D', 'E'], 'Z', 2);
    expect(ops.map((o) => o.body)).toEqual([
      { issues: ['A', 'B'], rankBeforeIssue: 'Z' },
      { issues: ['C', 'D'], rankAfterIssue: 'B' },
      { issues: ['E'], rankAfterIssue: 'D' },
    ]);
    expect(ops[2]!.dryRunMessage).toBe(
      '[dry-run] Would rank 1 issues (batch 2) after D',
    );
  });

  it('defaults to 50-issue batches', () => {
    const keys = Array.from({ length: 101 }, (_, i) => `K-${String(i)}`);
    const ops = planRerank(keys, 'Z');
    expect(ops.map((o) => o.body.issues.length)).toEqual([50, 50, 1]);
  });
});
