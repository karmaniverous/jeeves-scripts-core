/**
 * @module slack/channel-meta/report-input
 *
 * What a run reports: the inputs shared by the report file
 * (`channel-meta/report`, `channel-meta/report-fields`) and the Slack summary
 * (`channel-meta/summary`), including which workspaces' channels may show their
 * generated text in the report ({@link ReportInput.textAccounts}). Types
 * and constants only.
 */

import type { ChannelFacts } from './gather.js';
import type { MetaField } from './plan.js';
import type { Workspace } from './workspaces.js';

/** What happened to one field this run. */
export interface FieldOutcome {
  /** Channel id. */
  id: string;
  /** Field. */
  field: MetaField;
  /** Status. */
  status:
    | 'updated'
    | 'unchanged'
    | 'proposed'
    | 'would-update'
    | 'deferred'
    | 'failed'
    | 'rejected';
  /** Reason or Slack code. */
  detail?: string;
  /** The generated value (set, already current, proposed, or refused by
   * Slack). */
  text?: string;
  /** The channel's current value, beside a proposed one (dry run). */
  current?: string;
}

/** The report's inputs. */
export interface ReportInput {
  /** Report date (`YYYY-MM-DD`, configured zone). */
  date: string;
  /** Dry run or `--print-task`. */
  preview: boolean;
  /** Workspaces read. */
  workspaces: readonly Workspace[];
  /** Per-channel facts. */
  facts: readonly ChannelFacts[];
  /** Field outcomes. */
  outcomes: readonly FieldOutcome[];
  /** Why the worker's result couldn't be used, if it couldn't. */
  workerProblem?: string;
  /** Description and topic switches. */
  enabled: Record<MetaField, boolean>;
  /** Gateway accounts whose channels the description and topic sections
   * may name, with their generated and current text (`channel-meta/text-scope`):
   * by default only the report target's own workspace. Every other
   * workspace's channels are counted there, never named or quoted. */
  textAccounts: ReadonlySet<string>;
}

/** The fields, in report order. */
export const FIELDS: readonly MetaField[] = ['description', 'topic'];

/** Their section titles. */
export const FIELD_TITLES: Record<MetaField, string> = {
  description: 'Descriptions',
  topic: 'Topics',
};
