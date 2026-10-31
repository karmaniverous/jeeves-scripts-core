/**
 * @module config/absolute-path
 *
 * `isAbsolutePath`: whether a configured path is absolute on Windows
 * (`D:/x`, `D:\x`, `\\host\share`) or POSIX (`/x`). Pure; used by config
 * schemas that take absolute paths (`slack.channels.<id>.homeDir`,
 * `jobs.<id>.extraDirs`, the `punchList` and `transcripts` paths), so a
 * config validates the same on every host. `absolutePathSchema` is the Zod
 * field for one.
 */

import path from 'node:path';

import { z } from 'zod';

/** True when `p` is absolute on Windows or POSIX. */
export const isAbsolutePath = (p: string): boolean =>
  path.win32.isAbsolute(p) || path.posix.isAbsolute(p);

/** A non-empty absolute path field; `what` names it in the error. */
export const absolutePathSchema = (what: string) =>
  z
    .string()
    .min(1)
    .refine(isAbsolutePath, { message: `${what} must be an absolute path` });
