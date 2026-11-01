/**
 * @module slack/channel-meta/summary
 *
 * The Slack summary of a run (mrkdwn): numbers only (member channels per
 * workspace, missing home directories, sweep findings, unseeded metas,
 * descriptions and topics updated (in a dry run: proposed), unchanged,
 * pending and failed) and the
 * report file's insider link (`channel-meta/report` is the file). No channel name,
 * path or text: the summary may go to another workspace than the
 * channels'. Pure.
 */

import { homeDirMissing, noHomeDir, skipCount, unseeded } from './coverage.js';
import type { MetaField } from './plan.js';
import {
  FIELD_TITLES,
  type FieldOutcome,
  FIELDS,
  type ReportInput,
} from './report-input.js';
import { escapeSlack } from './slack-text.js';
import { missingScopes, type Workspace } from './workspaces.js';

/**
 * Per-field counts for the summary.
 *
 * @param input - The report's inputs.
 * @param field - Which field.
 * @returns Updated, proposed (dry run), unchanged, pending (deferred or
 *   to generate), failed
 *   (Slack refused or the worker's value was rejected), and channels
 *   skipped for a missing write scope.
 */
export function fieldCounts(
  input: ReportInput,
  field: MetaField,
): Record<
  'updated' | 'proposed' | 'unchanged' | 'pending' | 'failed' | 'noScope',
  number
> {
  const n = (statuses: readonly FieldOutcome['status'][]): number =>
    input.outcomes.filter(
      (o) => o.field === field && statuses.includes(o.status),
    ).length;
  return {
    updated: n(['updated']),
    proposed: n(['proposed']),
    unchanged: n(['unchanged']),
    pending: n(['deferred', 'would-update']),
    failed: n(['failed', 'rejected']),
    noScope: skipCount(input.facts, field, 'missing-scope'),
  };
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

const workspaceCount = (ws: Workspace): string => {
  const name = ws.team ? ` (${escapeSlack(ws.team)})` : '';
  if (ws.error !== undefined) return `\`${ws.account}\`${name} not read`;
  const missing = missingScopes(ws.scopes).length;
  return `${String(ws.channels.length)} in \`${ws.account}\`${name}${missing > 0 ? `, ${plural(missing, 'missing scope')}` : ''}`;
};

const fieldLine = (input: ReportInput, field: MetaField): string => {
  if (!input.enabled[field]) return `${FIELD_TITLES[field]}: off (report only)`;
  const c = fieldCounts(input, field);
  const parts = [
    input.preview
      ? `${String(c.proposed)} proposed`
      : `${String(c.updated)} updated`,
    `${String(c.unchanged)} unchanged`,
    `${String(c.pending)} pending`,
    `${String(c.failed)} failed`,
  ];
  if (c.noScope > 0) parts.push(`${String(c.noScope)} without write scope`);
  return `${FIELD_TITLES[field]}: ${parts.join(', ')}`;
};

/**
 * The Slack summary: numbers and the report link, nothing else.
 *
 * @param input - The report's inputs.
 * @param reportLink - The report's Slack mrkdwn link (`lib/server-link`).
 * @returns Slack mrkdwn.
 */
export function summaryPost(input: ReportInput, reportLink: string): string {
  const { facts } = input;
  const finding = (kind: string): number =>
    facts.filter((f) => f.finding?.kind === kind).length;
  const unreadable = facts.filter((f) => f.readError !== undefined).length;
  const incomplete = facts.filter((f) => f.sweepNotes !== undefined).length;
  return [
    `*Slack channel meta* (${input.date})${input.preview ? ' \u2014 preview: nothing set' : ''}`,
    `Member channels: ${input.workspaces.map(workspaceCount).join('; ')}`,
    `Home directories: ${String(facts.filter(noHomeDir).length)} missing, ${String(facts.filter(homeDirMissing).length)} missing on disk, ${plural(facts.filter(unseeded).length, 'unseeded meta')}`,
    `Sweep: ${plural(finding('proposal'), 'proposal')}, ${plural(finding('mismatch'), 'mismatch', 'mismatches')}, ${String(finding('missing-dir'))} assigned missing on disk`,
    ...FIELDS.map((field) => fieldLine(input, field)),
    ...(input.workerProblem === undefined
      ? []
      : ['Worker result unusable: no values set']),
    ...(unreadable > 0 ? [`Unreadable channels: ${String(unreadable)}`] : []),
    ...(incomplete > 0
      ? [`Sweep incomplete: ${plural(incomplete, 'channel')}`]
      : []),
    `Report: ${reportLink}`,
  ].join('\n');
}
