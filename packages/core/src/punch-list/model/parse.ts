/**
 * @module punch-list/model/parse
 *
 * Parse a punch-list file. Anything that does not
 * fit the format throws {@link PunchListParseError}, so a job fails
 * without writing. Entries a person typed without an id get
 * a fresh one, which the next render writes back.
 */

import {
  ENTRY_RE,
  INTEGRATED_BOX_RE,
  INTEGRATED_ON_RE,
  isStatusLine,
  MILESTONE_RE,
  newId,
  NONE,
} from './lines.js';
import {
  emptyPunchList,
  LIST_PREFIX,
  type ListEntry,
  type ListKey,
  type Milestone,
  type MilestoneKey,
  type PunchList,
  PunchListParseError,
  type SectionKey,
  SECTIONS,
} from './types.js';

const TITLE_RE = /^# Punch List — (\d{4}-\d{2}-\d{2})$/;

const sectionByHeading = new Map<string, SectionKey>(
  Object.entries(SECTIONS).map(([key, heading]) => [
    heading,
    key as SectionKey,
  ]),
);

/** Split into the date and each section's raw lines. */
const split = (
  content: string,
): { date: string; bodies: Map<SectionKey, string[]> } => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const first = lines.find((l) => l.trim() !== '') ?? '';
  const title = TITLE_RE.exec(first.trim());
  if (!title) {
    throw new PunchListParseError(
      'title',
      first,
      'expected "# Punch List — YYYY-MM-DD"',
    );
  }
  const bodies = new Map<SectionKey, string[]>();
  let current: SectionKey | undefined;
  for (const raw of lines.slice(lines.indexOf(first) + 1)) {
    const line = raw.trimEnd();
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = sectionByHeading.get((heading[1] ?? '').trim());
      if (!current)
        throw new PunchListParseError('file', line, 'unknown section');
      if (bodies.has(current))
        throw new PunchListParseError('file', line, 'duplicate section');
      bodies.set(current, []);
      continue;
    }
    if (!current) {
      if (line.trim() !== '')
        throw new PunchListParseError(
          'file',
          line,
          'text before the first section',
        );
      continue;
    }
    bodies.get(current)?.push(line);
  }
  return { date: title[1] ?? '', bodies };
};

const parseList = (key: ListKey, lines: string[]): ListEntry[] =>
  lines
    .filter((l) => l.trim() !== '' && l.trim() !== NONE)
    .map((line) => {
      const m = ENTRY_RE.exec(line.trim());
      if (!m)
        throw new PunchListParseError(
          SECTIONS[key],
          line,
          'not a checkbox entry',
        );
      const [, box, text = '', id] = m;
      const prefix = LIST_PREFIX[key];
      if (id && !id.startsWith(`${prefix}-`)) {
        throw new PunchListParseError(
          SECTIONS[key],
          line,
          `expected a "${prefix}-" id`,
        );
      }
      return {
        id: id ?? newId(prefix),
        checked: box !== ' ',
        text: text.trim(),
      };
    });

const trimBlank = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start++;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
  return lines.slice(start, end);
};

const parseMilestones = (key: MilestoneKey, lines: string[]): Milestone[] => {
  const blocks: Milestone[] = [];
  for (const line of lines) {
    const heading = MILESTONE_RE.exec(line);
    if (heading) {
      blocks.push({
        slug: heading[1] ?? '',
        title: (heading[2] ?? '').trim(),
        body: [],
        status: [],
      });
      continue;
    }
    const block = blocks.at(-1);
    if (!block) {
      if (line.trim() === '' || line.trim() === NONE) continue;
      throw new PunchListParseError(
        SECTIONS[key],
        line,
        'text before the first milestone',
      );
    }
    const box = INTEGRATED_BOX_RE.exec(line);
    const on = INTEGRATED_ON_RE.exec(line);
    if (box && key === 'done') block.integrated = box[1] !== ' ';
    else if (on && key === 'integrated') {
      block.integrated = on[1] !== ' ';
      block.integratedOn = on[2];
    } else if (isStatusLine(line)) block.status.push(line);
    else block.body.push(line);
  }
  for (const block of blocks) {
    block.body = trimBlank(block.body);
    if (key === 'done') block.integrated ??= false;
    if (key === 'integrated' && !block.integratedOn) {
      throw new PunchListParseError(
        SECTIONS[key],
        `### ${block.slug}`,
        'missing "- Integrated YYYY-MM-DD"',
      );
    }
  }
  return blocks;
};

/** Parse a punch-list file's full text. */
export const parsePunchList = (content: string): PunchList => {
  const { date, bodies } = split(content);
  const list = emptyPunchList(date);
  const lines = (key: SectionKey): string[] => bodies.get(key) ?? [];
  for (const key of Object.keys(LIST_PREFIX) as ListKey[]) {
    list[key] = parseList(key, lines(key));
  }
  for (const key of ['todo', 'done', 'integrated'] as const) {
    list[key] = parseMilestones(key, lines(key));
  }
  return list;
};
