/**
 * @module punch-list/model/lines
 *
 * Line grammar shared by parse and render: list entries, milestone
 * headings, the checker's status lines, and the date markers
 * (`added`, `done`, `processed`) carried in an entry's text.
 */

import { randomBytes } from 'node:crypto';

/** `- [ ] text · t-0a1b2c3d` with the id in a code span (optional when a person typed the line). */
export const ENTRY_RE = /^- \[( |x|X)\] (.+?)(?: · `([tb]-[0-9a-f]{8})`)?$/;

/** `### acme-slug — Title` */
export const MILESTONE_RE = /^### (\S+) — (.+)$/;

/** Prefixes of the checker's generated status lines in a milestone block. */
export const STATUS_PREFIX = {
  issues: '- Issues: ',
  releases: '- Releases: ',
  installed: '- Installed: ',
} as const;

/** Whether a line is a generated status line. */
export const isStatusLine = (line: string): boolean =>
  Object.values(STATUS_PREFIX).some((p) => line.startsWith(p));

/**
 * The title of an entry's text: the leading `**bold**` part, else the text
 * before ` — `; lower-cased for comparison.
 */
export const entryTitle = (text: string): string =>
  (/^\*\*(.+?)\*\*/.exec(text)?.[1] ?? text.split(' — ')[0] ?? text)
    .trim()
    .toLowerCase();

/** The Done checkbox. */
export const INTEGRATED_BOX_RE = /^- \[( |x|X)\] Integrated$/;

/** The Integrated date line. */
export const INTEGRATED_ON_RE =
  /^- \[( |x|X)\] Integrated (\d{4}-\d{2}-\d{2})$/;

/** Placeholder rendered in an empty section. */
export const NONE = '_None._';

/** A fresh id with this prefix. */
export const newId = (
  prefix: 't' | 'b',
  random: () => string = () => randomBytes(4).toString('hex'),
): string => `${prefix}-${random()}`;

export type Marker = 'added' | 'done' | 'processed';

const markerRe = (marker: Marker): RegExp =>
  new RegExp(`(?:^| · )${marker} (\\d{4}-\\d{2}-\\d{2})(?= · |$)`);

/** The date of `marker` in an entry's text, if present. */
export const getMarker = (text: string, marker: Marker): string | undefined =>
  markerRe(marker).exec(text)?.[1];

/** `text` without `marker` (and its separator). */
export const removeMarker = (text: string, marker: Marker): string =>
  text
    .replace(new RegExp(` · ${marker} \\d{4}-\\d{2}-\\d{2}(?= · |$)`), '')
    .trim();

/** `text` with `marker` set to `date`, at the end. */
export const setMarker = (text: string, marker: Marker, date: string): string =>
  `${removeMarker(text, marker)} · ${marker} ${date}`;

/** Render one list entry. */
export const renderEntry = (entry: {
  id: string;
  checked: boolean;
  text: string;
}): string =>
  `- [${entry.checked ? 'x' : ' '}] ${entry.text} · \`${entry.id}\``;
