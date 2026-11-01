/**
 * @module slack/channel-meta/report-fields
 *
 * The report file's Descriptions and Topics sections: what happened to
 * each field and why, grouped by status (with the generated text of each
 * value set, already current or refused; in a dry run, each proposed
 * value beside the current one), channels left alone for a missing
 * write scope, and skip counts. Only channels in a shown workspace
 * ({@link ReportInput.textAccounts}, `channel-meta/text-scope`) are named and
 * quoted; the others are counted per workspace. Pure.
 */

import { skipCount } from './coverage.js';
import type { ChannelFacts } from './gather.js';
import type { MetaField } from './plan.js';
import {
  FIELD_TITLES,
  type FieldOutcome,
  type ReportInput,
} from './report-input.js';
import { label, list, mdText } from './report-md.js';
import { type ScopedLine, scopedLines } from './text-scope.js';

const STATUS_TITLES: Record<FieldOutcome['status'], string> = {
  updated: 'Updated',
  unchanged: 'Generated, already current (not written)',
  proposed: 'Proposed (preview: not set)',
  'would-update': 'Would generate (preview)',
  failed: 'Failed',
  rejected: 'Worker value rejected',
  deferred: 'Waiting for a later run (batch cap)',
};

const quoted = (s: string): string =>
  s === '' ? '(empty)' : `\u201c${mdText(s)}\u201d`;

const outcomeLine = (o: FieldOutcome, f: ChannelFacts): string => {
  const head = `${label(f)}${o.detail ? `: ${mdText(o.detail)}` : ''}`;
  if (o.current !== undefined)
    return `${head}\n  - current: ${quoted(o.current)}\n  - proposed: ${quoted(o.text ?? '')}`;
  return `${head}${o.text === undefined ? '' : ` \u2014 ${quoted(o.text)}`}`;
};

/** A titled list of channels, shown ones named, the rest counted. */
const scopedList = (
  title: string,
  items: readonly ScopedLine[],
  shown: ReadonlySet<string>,
): string[] => list(title, scopedLines(items, shown), items.length);

/**
 * One field's section.
 *
 * @param field - Which field.
 * @param input - The report's inputs.
 * @param byId - Facts by channel id.
 * @returns Markdown lines.
 */
export function fieldSection(
  field: MetaField,
  input: ReportInput,
  byId: ReadonlyMap<string, ChannelFacts>,
): string[] {
  const title = `## ${FIELD_TITLES[field]}`;
  if (!input.enabled[field]) return [title, '', 'Switched off: report only.'];
  const shown = input.textAccounts;
  const lines = [title];
  for (const status of Object.keys(STATUS_TITLES) as FieldOutcome['status'][])
    lines.push(
      ...scopedList(
        STATUS_TITLES[status],
        input.outcomes.flatMap((o) => {
          const f = byId.get(o.id);
          return o.field === field && o.status === status && f
            ? [{ account: f.channel.account, line: outcomeLine(o, f) }]
            : [];
        }),
        shown,
      ),
    );
  lines.push(
    ...scopedList(
      'Left alone: the bot lacks the write scope',
      input.facts
        .filter(
          (f) =>
            f.plans[field].action === 'skip' &&
            f.plans[field].reason === 'missing-scope',
        )
        .map((f) => ({ account: f.channel.account, line: label(f) })),
      shown,
    ),
  );
  const counts: string[] = [];
  const fresh = skipCount(input.facts, field, 'fresh');
  if (fresh > 0)
    counts.push(
      `Up to date (nothing new since last generated): ${String(fresh)}`,
    );
  const quiet = field === 'topic' ? skipCount(input.facts, field, 'quiet') : 0;
  if (quiet > 0)
    counts.push(
      `Quiet (no human posts in the window, nothing new), left alone: ${String(quiet)}`,
    );
  if (counts.length > 0) lines.push('', ...counts.map((c) => `- ${c}`));
  return lines.length === 1 ? [...lines, '', 'No changes.'] : lines;
}
