/**
 * @module config/absolute-path
 *
 * `isAbsolutePath`: whether a configured path is absolute on Windows
 * (`D:/x`, `D:\x`, `\\host\share`) or POSIX (`/x`). Pure; used by config
 * schemas that take absolute paths (`slack.channels.<id>.homeDir`,
 * `jobs.<id>.extraDirs`), so a config validates the same on every host.
 */

import path from 'node:path';

/** True when `p` is absolute on Windows or POSIX. */
export const isAbsolutePath = (p: string): boolean =>
  path.win32.isAbsolute(p) || path.posix.isAbsolute(p);
