/**
 * @module config/relative-path
 *
 * The relative-path rule config fields share (the library mirror's
 * `subdir` and `dest`, `github-sync-files`' `files[].source`): no leading
 * `/` or `\` (so no UNC path), no drive letter, no `..` segment.
 */

import { z } from 'zod';

/** The `/`-separated segments of a relative path (backslashes count as `/`; empty and `.` dropped). */
export const pathSegments = (p: string): string[] =>
  p.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');

/** True when `p` is relative: no leading `/` or `\`, no drive letter. */
const isRelative = (p: string): boolean => !/^([\\/]|[A-Za-z]:)/.test(p);

/** A string schema for a relative path with no `..` segment; `what` names the field in messages. */
export const relativePath = (what: string) =>
  z
    .string()
    .refine(isRelative, { message: `${what} must be a relative path` })
    .refine((p) => !pathSegments(p).includes('..'), {
      message: `${what} must not contain a .. segment`,
    });
