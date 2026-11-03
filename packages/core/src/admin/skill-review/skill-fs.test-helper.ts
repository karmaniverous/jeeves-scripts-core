/**
 * @module admin/skill-review/skill-fs.test-helper
 *
 * An in-memory `SkillFs` for the skill-review tests: files are given by
 * path (any separator), directories are implied by them. Test-only.
 */

import path from 'node:path';

import type { SkillFs } from './skill-fs.js';

/** One file: its text, or its text and modification time. */
type FileSpec = string | { text: string; mtimeMs: number };

const norm = (p: string): string => path.resolve(p);

/**
 * Build an in-memory file system.
 *
 * @param files - File specs by path.
 * @returns The port.
 */
export function memorySkillFs(files: Record<string, FileSpec>): SkillFs {
  const byPath = new Map(
    Object.entries(files).map(([p, spec]) => [norm(p), spec]),
  );
  const children = (dir: string, wantDirs: boolean): string[] => {
    const base = norm(dir) + path.sep;
    const names = new Set<string>();
    for (const p of byPath.keys()) {
      if (!p.startsWith(base)) continue;
      const parts = p.slice(base.length).split(path.sep);
      const isDir = parts.length > 1;
      if (isDir === wantDirs && parts[0]) names.add(parts[0]);
    }
    return [...names].sort();
  };
  return {
    listDirs: (dir) => children(dir, true),
    listFiles: (dir) => children(dir, false),
    readText: (file) => {
      const spec = byPath.get(norm(file));
      return typeof spec === 'string' ? spec : spec?.text;
    },
    mtimeMs: (file) => {
      const spec = byPath.get(norm(file));
      if (spec === undefined) return undefined;
      return typeof spec === 'string' ? 0 : spec.mtimeMs;
    },
  };
}

/** A SKILL.md text with frontmatter. */
export const skillText = (
  name: string,
  description: string,
  body = '',
): string =>
  `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n${body}`;
