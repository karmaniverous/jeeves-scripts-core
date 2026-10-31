/**
 * @module punch-list/model/transitions
 *
 * Pure state changes on a {@link PunchList}:
 * applying ticks and unticks, leaving off finished entries older than the
 * retention period, and rolling a file over to a new day.
 */

import { daysBetween } from '../dates.js';
import {
  getMarker,
  type Marker,
  removeMarker,
  setMarker,
  STATUS_PREFIX,
} from './lines.js';
import type { ListEntry, Milestone, PunchList } from './types.js';

/** What {@link applyTicks} moved, by entry title text or milestone slug. */
export interface TickMoves {
  completed: string[];
  reopenedTasks: string[];
  processed: string[];
  reopenedBacklog: string[];
  integrated: string[];
  unintegrated: string[];
}

const partition = <T>(items: T[], test: (item: T) => boolean): [T[], T[]] => [
  items.filter(test),
  items.filter((i) => !test(i)),
];

const finish = (e: ListEntry, marker: Marker, today: string): ListEntry => ({
  ...e,
  checked: true,
  text: setMarker(e.text, marker, today),
});

const reopen = (e: ListEntry, marker: Marker): ListEntry => ({
  ...e,
  checked: false,
  text: removeMarker(e.text, marker),
});

const toIntegrated = (m: Milestone, today: string): Milestone => ({
  slug: m.slug,
  title: m.title,
  body: m.body,
  status: m.status.filter((l) => !l.startsWith(STATUS_PREFIX.installed)),
  integrated: true,
  integratedOn: today,
});

const backToDone = (m: Milestone): Milestone => ({
  slug: m.slug,
  title: m.title,
  body: m.body,
  status: m.status,
  integrated: false,
});

/**
 * Move ticked Tasks to Completed Tasks, ticked Backlog items to Processed
 * Backlog Items and ticked Done milestones to Integrated; unticked
 * finished entries and Integrated milestones go back (the status checker
 * refreshes a returned milestone's status lines in the same pass). Finished entries are stamped with `today`.
 */
export const applyTicks = (
  list: PunchList,
  today: string,
): { list: PunchList; moves: TickMoves } => {
  const [doneTasks, openTasks] = partition(list.tasks, (e) => e.checked);
  const [reopenTasks, keptCompleted] = partition(
    list.completedTasks,
    (e) => !e.checked,
  );
  const [doneBacklog, openBacklog] = partition(list.backlog, (e) => e.checked);
  const [reopenBacklog, keptProcessed] = partition(
    list.processedBacklog,
    (e) => !e.checked,
  );
  const [nowIntegrated, stillDone] = partition(
    list.done,
    (m) => m.integrated === true,
  );
  const [unintegrated, keptIntegrated] = partition(
    list.integrated,
    (m) => m.integrated === false,
  );
  return {
    list: {
      ...list,
      tasks: [...openTasks, ...reopenTasks.map((e) => reopen(e, 'done'))],
      completedTasks: [
        ...keptCompleted,
        ...doneTasks.map((e) => finish(e, 'done', today)),
      ],
      backlog: [
        ...openBacklog,
        ...reopenBacklog.map((e) => reopen(e, 'processed')),
      ],
      processedBacklog: [
        ...keptProcessed,
        ...doneBacklog.map((e) => finish(e, 'processed', today)),
      ],
      done: [...stillDone, ...unintegrated.map(backToDone)],
      integrated: [
        ...keptIntegrated,
        ...nowIntegrated.map((m) => toIntegrated(m, today)),
      ],
    },
    moves: {
      completed: doneTasks.map((e) => e.text),
      reopenedTasks: reopenTasks.map((e) => e.text),
      processed: doneBacklog.map((e) => e.text),
      reopenedBacklog: reopenBacklog.map((e) => e.text),
      integrated: nowIntegrated.map((m) => m.slug),
      unintegrated: unintegrated.map((m) => m.slug),
    },
  };
};

const fresh = (
  date: string | undefined,
  today: string,
  days: number,
): boolean => date === undefined || daysBetween(date, today) <= days;

/**
 * Leave off finished entries older than `retentionDays` (archiving is omission). An entry with no date is kept.
 */
export const omitExpired = (
  list: PunchList,
  today: string,
  retentionDays: number,
): PunchList => ({
  ...list,
  completedTasks: list.completedTasks.filter((e) =>
    fresh(getMarker(e.text, 'done'), today, retentionDays),
  ),
  processedBacklog: list.processedBacklog.filter((e) =>
    fresh(getMarker(e.text, 'processed'), today, retentionDays),
  ),
  integrated: list.integrated.filter((m) =>
    fresh(m.integratedOn, today, retentionDays),
  ),
});

/** The next day's file: ticks applied, expired entries omitted, dated `today`. */
export const rollOver = (
  previous: PunchList,
  today: string,
  retentionDays: number,
): PunchList =>
  omitExpired(
    { ...applyTicks(previous, today).list, date: today },
    today,
    retentionDays,
  );

/** Whether any tick move happened. */
export const anyMoves = (moves: TickMoves): boolean =>
  Object.values(moves).some((m: string[]) => m.length > 0);
