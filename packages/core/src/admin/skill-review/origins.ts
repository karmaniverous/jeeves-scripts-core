/**
 * @module admin/skill-review/origins
 *
 * Where a skill comes from, decided by package and root kind, never by a
 * host path: the innermost `node_modules/<package>` segment of the skill's
 * path names the shipping package (`@karmaniverous/jeeves` = `jeeves`,
 * `@karmaniverous/jeeves-scripts-core`, `@karmaniverous/jeeves-tools`,
 * `openclaw` = `openclaw-bundled`). Outside a package, the root kind
 * decides: Workshop skills are `workshop`, plugin-installed skills
 * `plugin`, and a workspace skill is `jeeves-tools` when the installed
 * jeeves-tools package ships a skill of that name (jeeves-tools installs
 * its skills to the workspace), else `local`. Pure.
 */

/** A skill's origin label. */
export type SkillOrigin =
  | 'workshop'
  | 'jeeves'
  | 'jeeves-scripts-core'
  | 'jeeves-tools'
  | 'openclaw-bundled'
  | 'plugin'
  | 'local';

/** What kind of skill root a skill was found in. */
export type SkillRootKind =
  'workshop' | 'extra' | 'managed' | 'plugin' | 'workspace' | 'bundled';

/** npm package name to origin, for the packages that ship skills. */
const PACKAGE_ORIGINS: Readonly<Record<string, SkillOrigin>> = {
  '@karmaniverous/jeeves': 'jeeves',
  '@karmaniverous/jeeves-scripts-core': 'jeeves-scripts-core',
  '@karmaniverous/jeeves-tools': 'jeeves-tools',
  openclaw: 'openclaw-bundled',
};

/**
 * The innermost npm package a path lies in.
 *
 * @param file - Any path (either separator).
 * @returns The package name (`@scope/name` or `name`), or `undefined`.
 */
export function packageOf(file: string): string | undefined {
  const matches = [
    ...file
      .replaceAll('\\', '/')
      .matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g),
  ];
  return matches.at(-1)?.[1];
}

/**
 * Classify a skill's origin.
 *
 * @param skillFile - The skill's SKILL.md path.
 * @param rootKind - The kind of root it was found in.
 * @param name - The skill name.
 * @param jeevesToolsSkills - Names the installed jeeves-tools ships.
 * @returns The origin label.
 */
export function classifyOrigin(
  skillFile: string,
  rootKind: SkillRootKind,
  name: string,
  jeevesToolsSkills: ReadonlySet<string>,
): SkillOrigin {
  if (rootKind === 'workshop') return 'workshop';
  const pkg = packageOf(skillFile);
  const fromPackage = pkg === undefined ? undefined : PACKAGE_ORIGINS[pkg];
  if (fromPackage) return fromPackage;
  if (rootKind === 'plugin') return 'plugin';
  if (rootKind === 'bundled') return 'openclaw-bundled';
  if (rootKind === 'workspace' && jeevesToolsSkills.has(name))
    return 'jeeves-tools';
  return 'local';
}

/**
 * Skill names embedded in a jeeves-tools build: its bundle carries each
 * SKILL.md as a JS string, so the frontmatter appears as an escaped
 * `---\nname: <name>\n` sequence.
 *
 * @param source - Text of a built jeeves-tools module.
 * @returns The skill names found.
 */
export function embeddedSkillNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(
    /---\\nname: ["']?([a-z0-9][a-z0-9-]*)["']?\\n/g,
  ))
    if (m[1]) names.add(m[1]);
  return [...names].sort();
}
