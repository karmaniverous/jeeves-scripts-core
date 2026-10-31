/**
 * @module punch-list/store
 *
 * The daily files on disk: today's file is rolled
 * over from the latest earlier one when missing, every change is a pure
 * function of the parsed file, and a write re-reads the file first and
 * retries when someone (a person ticking a box, the assistant adding an item)
 * changed it meanwhile. Writes are atomic (temp file + rename).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { withLock } from './lock.js';
import { parsePunchList } from './model/parse.js';
import { renderPunchList } from './model/render.js';
import { rollOver } from './model/transitions.js';
import { emptyPunchList, type PunchList } from './model/types.js';

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** The file for `day`. */
export const dayFile = (dir: string, day: string): string =>
  join(dir, `${day}.md`);

/** The latest daily file strictly before `day`, if any. */
export const latestBefore = (dir: string, day: string): string | undefined => {
  if (!existsSync(dir)) return undefined;
  const days = readdirSync(dir)
    .map((f) => DAY_FILE_RE.exec(f)?.[1])
    .filter((d): d is string => d !== undefined && d < day)
    .sort();
  const last = days.at(-1);
  return last ? dayFile(dir, last) : undefined;
};

const readIfExists = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, 'utf8') : undefined;

/** Options for {@link loadToday} and {@link updateToday}. */
export interface StoreOptions {
  dir: string;
  today: string;
  retentionDays: number;
  /** Cross-process lock held by every job write (`lock.ts`). */
  lockFile: string;
}

/** Today's punch list: the file when it exists, else rolled over from the latest earlier one. */
export const loadToday = ({
  dir,
  today,
  retentionDays,
}: Omit<StoreOptions, 'lockFile'>): {
  list: PunchList;
  text: string | undefined;
} => {
  const text = readIfExists(dayFile(dir, today));
  if (text !== undefined) return { list: parsePunchList(text), text };
  const previous = latestBefore(dir, today);
  const base = previous
    ? parsePunchList(readFileSync(previous, 'utf8'))
    : emptyPunchList(today);
  return { list: rollOver(base, today, retentionDays), text };
};

const writeAtomic = (file: string, content: string): void => {
  const tmp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
};

/** What {@link updateToday} did. */
export interface UpdateResult<R> {
  list: PunchList;
  /** The change's own result (moves, counts, …). */
  result: R;
  /** Whether the rendered file differs from what was on disk. */
  changed: boolean;
  /** The rendered file. */
  content: string;
}

/**
 * Apply `change` to today's list and write it (unless `dryRun`). A write
 * holds the store's lock for the whole load → change → write, and still
 * retries up to `attempts` times when someone outside the lock (a person,
 * the assistant) changed the file between read and write.
 *
 * @throws `PunchListParseError` when a file does not parse (nothing is written).
 */
export const updateToday = <R>(
  options: StoreOptions & { dryRun?: boolean; attempts?: number },
  change: (list: PunchList) => { list: PunchList; result: R },
): UpdateResult<R> => {
  if (options.dryRun) {
    const { list, text } = loadToday(options);
    const next = change(list);
    const content = renderPunchList(next.list);
    return {
      list: next.list,
      result: next.result,
      changed: content !== text,
      content,
    };
  }
  return withLock(options.lockFile, () => writeToday(options, change));
};

const writeToday = <R>(
  options: StoreOptions & { attempts?: number },
  change: (list: PunchList) => { list: PunchList; result: R },
): UpdateResult<R> => {
  const file = dayFile(options.dir, options.today);
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    const { list, text } = loadToday(options);
    const next = change(list);
    const content = renderPunchList(next.list);
    const changed = content !== text;
    if (!changed) {
      return { list: next.list, result: next.result, changed, content };
    }
    if (readIfExists(file) === text) {
      mkdirSync(options.dir, { recursive: true });
      writeAtomic(file, content);
      return { list: next.list, result: next.result, changed, content };
    }
    if (attempt >= attempts) {
      throw new Error(
        `punch list ${file} kept changing during the update; gave up after ${String(attempts)} attempts`,
      );
    }
  }
};
