/**
 * @module punch-list/harvest/input
 *
 * The harvester's cursor and new-input pre-check.
 * The cursor is the start of the next harvest window: the start of the
 * last successful run, or, before the first success, a bootstrap start
 * saved by the first attempt so retries keep the same window. The
 * pre-check walks the input roots for anything modified since the cursor
 * and stops at the first hit.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from 'zod';

const cursorSchema = z.object({ windowStart: z.iso.datetime() });

/** The start of the next harvest window, if one was saved. */
export const readCursor = (file: string): Date | undefined => {
  if (!existsSync(file)) return undefined;
  return new Date(
    cursorSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).windowStart,
  );
};

/** Save the start of the next harvest window. */
export const writeCursor = (file: string, at: Date): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ windowStart: at.toISOString() }, null, 2)}\n`,
  );
};

/**
 * Whether any input changed after `since`: a root that is a file counts
 * by its own mtime; a directory by any file under it (dot-entries are
 * skipped). Missing roots are ignored.
 */
export const hasNewInput = (roots: string[], since: Date): boolean => {
  const cutoff = since.getTime();
  const existing = roots.filter((r) => existsSync(r));
  if (
    existing.some((r) => statSync(r).isFile() && statSync(r).mtimeMs > cutoff)
  )
    return true;
  const stack = existing.filter((r) => statSync(r).isDirectory());
  while (stack.length) {
    const dir = stack.pop() ?? '';
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && statSync(path).mtimeMs > cutoff) return true;
    }
  }
  return false;
};
