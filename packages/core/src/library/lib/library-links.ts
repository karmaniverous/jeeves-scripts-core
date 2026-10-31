/**
 * @module library/lib/library-links
 *
 * Site-relative link rewriting for the library mirror (spec 2.9,
 * Decision 74): a mirror's `siteLinks` is a fixed two-placeholder
 * template. `pattern` (e.g. `/skill/{name}`) is the link as written for
 * the upstream's website; `target` (e.g. `{dir}/SKILL.md`) is the mirrored
 * file it means, whose `{dir}` ends in `{name}`. A Markdown link
 * `](<pattern>[/][#anchor])` that resolves to exactly one target becomes
 * a relative link to that file; anything else is left unchanged.
 */

import path from 'node:path';

import {
  LIBRARY_LINK_DIR,
  LIBRARY_LINK_NAME,
} from '../../config/library-schema.js';

/** Escape `s` for use as a literal in a regular expression. */
const literal = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** A link name: what `{name}` matches. */
const NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';

/** The parts of `template` before and after `placeholder` (validated to occur once). */
const around = (template: string, placeholder: string): [string, string] => {
  const at = template.indexOf(placeholder);
  return [template.slice(0, at), template.slice(at + placeholder.length)];
};

/**
 * The global regex for Markdown links `](<pattern>[/][#anchor])`; group 1
 * is the name, group 2 the anchor (`''` when none).
 */
export const linkPattern = (pattern: string): RegExp => {
  const [before, after] = around(pattern, LIBRARY_LINK_NAME);
  return new RegExp(
    `\\]\\(${literal(before)}(${NAME})${literal(after)}\\/?((?:#[^)\\s]*)?)\\)`,
    'g',
  );
};

/**
 * Index the link targets among `files` (mirror-relative, `/`-separated)
 * by name: every file matching `target`, under the last segment of the
 * path `{dir}` matched.
 */
export const indexLinkTargets = (
  files: readonly string[],
  target: string,
): Map<string, string[]> => {
  const [before, after] = around(target, LIBRARY_LINK_DIR);
  const match = new RegExp(`^${literal(before)}(.+)${literal(after)}$`);
  const index = new Map<string, string[]>();
  for (const file of files) {
    const dir = match.exec(file)?.[1];
    if (dir === undefined) continue;
    const name = path.posix.basename(dir);
    index.set(name, [...(index.get(name) ?? []), file]);
  }
  return index;
};

/** The first `/`-separated segment of a mirror-relative path. */
const top = (rel: string): string => rel.split('/')[0] ?? '';

/**
 * Rewrite the links `pattern` (from {@link linkPattern}) matches in
 * `text`, the content of `fileRel`, to relative links to their targets. A
 * target under the same top-level directory as `fileRel` wins over one
 * elsewhere; a name with no target, or with several and no single one in
 * the same top-level directory, is left unchanged.
 */
export const rewriteLinks = (
  text: string,
  fileRel: string,
  index: ReadonlyMap<string, readonly string[]>,
  pattern: RegExp,
): { text: string; rewritten: number } => {
  const fromDir = path.posix.dirname(fileRel);
  let rewritten = 0;
  const out = text.replace(pattern, (link, name: string, anchor: string) => {
    const targets = index.get(name) ?? [];
    const near = targets.filter((t) => top(t) === top(fileRel));
    const target =
      near.length === 1
        ? near[0]
        : targets.length === 1
          ? targets[0]
          : undefined;
    if (target === undefined) return link;
    rewritten++;
    return `](${path.posix.relative(fromDir, target)}${anchor})`;
  });
  return { text: out, rewritten };
};
