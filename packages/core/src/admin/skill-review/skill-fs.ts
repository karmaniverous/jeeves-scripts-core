/**
 * @module admin/skill-review/skill-fs
 *
 * The read-only file system port the gather step uses (skill roots, the
 * Workshop proposal store, the OpenClaw package), so tests pass an
 * in-memory one. `nodeSkillFs` is the live implementation: every read of
 * a missing or unreadable path returns empty / `undefined` instead of
 * throwing, since an absent skill root is normal.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Read-only file system access for the gather step. */
export interface SkillFs {
  /** Names of the subdirectories of `dir` (`[]` when it doesn't exist). */
  listDirs: (dir: string) => string[];
  /** Names of the files directly in `dir` (`[]` when it doesn't exist). */
  listFiles: (dir: string) => string[];
  /** A file's UTF-8 text, or `undefined` when it can't be read. */
  readText: (file: string) => string | undefined;
  /** A file's modification time (ms), or `undefined` when missing. */
  mtimeMs: (file: string) => number | undefined;
}

/**
 * A comparison key for a path: resolved, and lower-cased on Windows
 * (case-insensitive paths), so one location gives one key. Elsewhere case
 * is kept: on a case-sensitive file system `/skills/A` and `/skills/a`
 * are different directories.
 *
 * @param p - Any path.
 * @param platform - The platform (default `process.platform`).
 * @returns The key.
 */
export const pathKey = (
  p: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  const resolved = path.resolve(p);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/**
 * Whether `rel` names a file inside whatever directory it is joined to:
 * not absolute or drive-relative, no `..` segment (either separator), and
 * not the directory itself. Artifact paths come from proposal metadata and
 * must never reach outside their directory.
 *
 * @param rel - A relative path (`/` or `\` separators).
 * @returns `true` when safe.
 */
export const isSafeRelative = (rel: string): boolean => {
  const segments = rel.split(/[\\/]/);
  return (
    !path.isAbsolute(rel) &&
    !/^[A-Za-z]:/.test(rel) &&
    !segments.includes('..') &&
    segments.some((s) => s !== '' && s !== '.')
  );
};

/**
 * `rel` resolved under `root`, or `undefined` when it isn't
 * {@link isSafeRelative}.
 *
 * @param root - The containing directory.
 * @param rel - A relative path.
 * @returns The absolute path inside `root`, or `undefined`.
 */
export const containedPath = (root: string, rel: string): string | undefined =>
  isSafeRelative(rel) ? path.resolve(root, rel) : undefined;

/** What an entry is, following symbolic links and junctions. */
const kindOf = (dir: string, e: fs.Dirent): 'dir' | 'file' | 'other' => {
  if (e.isDirectory()) return 'dir';
  if (e.isFile()) return 'file';
  if (!e.isSymbolicLink()) return 'other';
  try {
    const stat = fs.statSync(path.join(dir, e.name));
    return stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
  } catch {
    return 'other';
  }
};

/** Names of the entries of `dir` of one kind, or `[]`. */
const entries = (dir: string, kind: 'dir' | 'file'): string[] => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => kindOf(dir, e) === kind)
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
};

/** The live {@link SkillFs} on `node:fs` (links and junctions followed). */
export const nodeSkillFs: SkillFs = {
  listDirs: (dir) => entries(dir, 'dir'),
  listFiles: (dir) => entries(dir, 'file'),
  readText: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  mtimeMs: (file) => {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
  },
};

/**
 * Every file under `dir`, as paths relative to it with `/` separators.
 *
 * @param skillFs - File system port.
 * @param dir - Directory to walk.
 * @param maxDepth - Deepest level to descend (default 4).
 * @returns Relative file paths, sorted.
 */
export function walkFiles(
  skillFs: SkillFs,
  dir: string,
  maxDepth = 4,
): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    const abs = rel ? path.join(dir, rel) : dir;
    for (const f of skillFs.listFiles(abs)) out.push(rel ? `${rel}/${f}` : f);
    if (depth >= maxDepth) return;
    for (const d of skillFs.listDirs(abs)) {
      if (d === 'node_modules' || d.startsWith('.')) continue;
      walk(rel ? `${rel}/${d}` : d, depth + 1);
    }
  };
  walk('', 0);
  return out.sort();
}
