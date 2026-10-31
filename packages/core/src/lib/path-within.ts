/**
 * @module lib/path-within
 *
 * Path containment: whether a resolved path is a directory or lies inside
 * it. Lexical only; pass `fs.realpathSync` results to see through links.
 */

import path from 'node:path';

/** True when `p` is `root` or lies under it (both resolved first). */
export const isWithin = (root: string, p: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return !(
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  );
};
