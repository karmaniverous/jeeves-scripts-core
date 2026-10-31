/**
 * @module punch-list/harvest/merge
 *
 * Merge reported items into Backlog: file
 * sources become jeeves-server links (a path outside the server's roots,
 * or not an existing file, is dropped), telemetry references are kept as
 * code, and an item left with no source, or whose title is already on the
 * list, is skipped. Pure apart from the injected link function.
 */

import { isAbsolutePath } from '../../config/absolute-path.js';
import { entryTitle, newId } from '../model/lines.js';
import type { ListEntry, PunchList } from '../model/types.js';
import type { ReportItem } from './report.js';

/** Turns a file path into a Markdown link, or `undefined` when it cannot. */
export type LinkFile = (path: string) => string | undefined;

export interface MergeResult {
  added: ReportItem[];
  skipped: { title: string; reason: string }[];
}

/** One line of text: no newlines, no ` · ` separators, no stray bold markers. */
const clean = (s: string): string =>
  s.replace(/\s+/g, ' ').replace(/ · /g, ', ').replace(/\*\*/g, '').trim();

/** Render the sources, dropping the ones that cannot be linked. */
export const renderSources = (sources: string[], link: LinkFile): string[] =>
  sources.flatMap((s) => {
    if (!isAbsolutePath(s)) return [`\`${s}\``];
    const md = link(s);
    return md ? [md] : [];
  });

/** A Backlog entry's text for an item. */
export const itemText = (
  item: ReportItem,
  sources: string[],
  today: string,
): string => {
  const kind =
    item.kind === 'requested'
      ? `requested by ${clean(item.requester ?? 'unknown')}`
      : 'inferred';
  return `**${clean(item.title)}** — ${clean(item.why)} · ${kind} · sources: ${sources.join(', ')} · added ${today}`;
};

/**
 * Every title already on the list, lower-cased: all list entries (open and
 * finished) and every milestone, so finished or promoted work is not
 * proposed again.
 */
export const listedTitles = (list: PunchList): string[] => [
  ...[
    ...list.tasks,
    ...list.completedTasks,
    ...list.backlog,
    ...list.processedBacklog,
  ].map((e) => entryTitle(e.text)),
  ...[...list.todo, ...list.done, ...list.integrated].map((m) =>
    m.title.trim().toLowerCase(),
  ),
];

/** Add `items` to the list's Backlog. */
export const mergeItems = (
  list: PunchList,
  items: ReportItem[],
  link: LinkFile,
  today: string,
  makeId: () => string = () => newId('b'),
): { list: PunchList; result: MergeResult } => {
  const known = new Set(listedTitles(list));
  const result: MergeResult = { added: [], skipped: [] };
  const entries: ListEntry[] = [];
  for (const item of items) {
    const title = clean(item.title).toLowerCase();
    if (known.has(title)) {
      result.skipped.push({ title: item.title, reason: 'already on the list' });
      continue;
    }
    const sources = renderSources(item.sources, link);
    if (!sources.length) {
      result.skipped.push({ title: item.title, reason: 'no linkable source' });
      continue;
    }
    known.add(title);
    entries.push({
      id: makeId(),
      checked: false,
      text: itemText(item, sources, today),
    });
    result.added.push(item);
  }
  return { list: { ...list, backlog: [...list.backlog, ...entries] }, result };
};
