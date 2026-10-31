/**
 * @module punch-list/model/types
 *
 * The punch-list file model. List
 * sections hold checkbox entries with a stable id; TODO, Done and
 * Integrated hold milestone blocks keyed by `<instance>-<slug>`.
 */

import { z } from 'zod';

/** Stable entry id: `t-` for tasks, `b-` for backlog items, then 8 hex digits. */
export const entryIdSchema = z.string().regex(/^[tb]-[0-9a-f]{8}$/);

/**
 * One checkbox entry. `text` is everything between the checkbox and the
 * id, kept verbatim (`**Title** — details · …`), so edits by people and
 * by the assistant survive a round trip.
 */
export const listEntrySchema = z.object({
  /** Stable id (`t-…` or `b-…`). */
  id: entryIdSchema,
  /** Whether the checkbox is ticked. */
  checked: z.boolean(),
  /** Everything between the checkbox and the id, verbatim. */
  text: z.string().min(1),
});
/** One checkbox entry. */
export type ListEntry = z.infer<typeof listEntrySchema>;

/**
 * One milestone block (`### acme-slug — Title`). `body` is free prose kept
 * verbatim; `status` holds the checker's generated lines (Issues,
 * Releases, Installed); `integrated` is the Integrated checkbox (ticked in
 * Done to integrate, unticked in Integrated to send it back) and
 * `integratedOn` the date it moved to Integrated.
 */
export const milestoneSchema = z.object({
  /** The GitHub milestone title (an opaque string). */
  slug: z.string().min(1),
  /** The heading text after the slug. */
  title: z.string().min(1),
  /** Free prose lines, verbatim. */
  body: z.array(z.string()),
  /** The checker's generated status lines. */
  status: z.array(z.string()),
  /** The Integrated checkbox (Done and Integrated only). */
  integrated: z.boolean().optional(),
  /** `YYYY-MM-DD` it moved to Integrated. */
  integratedOn: z.string().optional(),
});
/** One milestone block. */
export type Milestone = z.infer<typeof milestoneSchema>;

/** One day's punch-list file. */
export const punchListModelSchema = z.object({
  /** The file's day, `YYYY-MM-DD`. */
  date: z.string(),
  /** Tasks: platform work to do. */
  tasks: z.array(listEntrySchema),
  /** Backlog: requested or inferred work not yet planned. */
  backlog: z.array(listEntrySchema),
  /** Milestones being worked. */
  todo: z.array(milestoneSchema),
  /** Milestones whose issues all shipped. */
  done: z.array(milestoneSchema),
  /** Finished milestones. */
  integrated: z.array(milestoneSchema),
  /** Finished tasks. */
  completedTasks: z.array(listEntrySchema),
  /** Promoted, done or rejected backlog items. */
  processedBacklog: z.array(listEntrySchema),
});
/** One day's punch-list file. */
export type PunchList = z.infer<typeof punchListModelSchema>;

/** Section headings, in file order. */
export const SECTIONS = {
  tasks: 'Tasks',
  backlog: 'Backlog',
  todo: 'TODO',
  done: 'Done',
  integrated: 'Integrated',
  completedTasks: 'Completed Tasks',
  processedBacklog: 'Processed Backlog Items',
} as const satisfies Record<keyof Omit<PunchList, 'date'>, string>;

export type SectionKey = keyof typeof SECTIONS;

/** Which list sections hold which id prefix. */
export const LIST_PREFIX = {
  tasks: 't',
  completedTasks: 't',
  backlog: 'b',
  processedBacklog: 'b',
} as const;

export type ListKey = keyof typeof LIST_PREFIX;
export type MilestoneKey = 'todo' | 'done' | 'integrated';

/** A punch-list file that does not match the format; the job writes nothing. */
export class PunchListParseError extends Error {
  constructor(
    readonly section: string,
    readonly line: string,
    reason: string,
  ) {
    super(`punch list ${section}: ${reason}: ${JSON.stringify(line)}`);
    this.name = 'PunchListParseError';
  }
}

/** An empty punch list for `date`. */
export const emptyPunchList = (date: string): PunchList => ({
  date,
  tasks: [],
  backlog: [],
  todo: [],
  done: [],
  integrated: [],
  completedTasks: [],
  processedBacklog: [],
});
