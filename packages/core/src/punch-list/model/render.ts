/**
 * @module punch-list/model/render
 *
 * Render a {@link PunchList} as Markdown, in section order. The inverse of
 * `parse.ts`: `parsePunchList(renderPunchList(x))` equals `x`.
 */

import { NONE, renderEntry } from './lines.js';
import {
  type ListEntry,
  type Milestone,
  type MilestoneKey,
  type PunchList,
  type SectionKey,
  SECTIONS,
} from './types.js';

const renderMilestone = (key: MilestoneKey, m: Milestone): string[] => {
  const lines = [`### ${m.slug} — ${m.title}`, ''];
  if (m.body.length) lines.push(...m.body, '');
  lines.push(...m.status);
  if (key === 'done') lines.push(`- [${m.integrated ? 'x' : ' '}] Integrated`);
  if (key === 'integrated' && m.integratedOn) {
    lines.push(
      `- [${m.integrated === false ? ' ' : 'x'}] Integrated ${m.integratedOn}`,
    );
  }
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

const renderSection = (list: PunchList, key: SectionKey): string[] => {
  const head = [`## ${SECTIONS[key]}`, ''];
  if (key === 'todo' || key === 'done' || key === 'integrated') {
    const blocks = list[key];
    if (!blocks.length) return [...head, NONE];
    return [
      ...head,
      ...blocks.flatMap((m, i) => [
        ...(i ? [''] : []),
        ...renderMilestone(key, m),
      ]),
    ];
  }
  const entries: ListEntry[] = list[key];
  return entries.length
    ? [...head, ...entries.map(renderEntry)]
    : [...head, NONE];
};

/** Render the whole file, ending in a newline. */
export const renderPunchList = (list: PunchList): string =>
  [
    `# Punch List — ${list.date}`,
    ...(Object.keys(SECTIONS) as SectionKey[]).flatMap((key) => [
      '',
      ...renderSection(list, key),
    ]),
  ].join('\n') + '\n';
