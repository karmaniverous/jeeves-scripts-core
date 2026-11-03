/**
 * @module admin/skill-review/inventory
 *
 * The skill inventory a Workshop proposal is judged against, read from
 * disk. Roots, all discovered from OpenClaw's own config and layout:
 *
 * - Workshop skills: `<stateDir>/agents/<agent>/agent/workshop-skills`, every agent;
 * - `skills.load.extraDirs` from `openclaw.json`;
 * - `<stateDir>/skills` (managed) and `<stateDir>/plugin-skills`;
 * - `<workspace>/skills` for `agents.defaults.workspace`, each
 *   `agents.list[].workspace` and OpenClaw's default `<stateDir>/workspace`;
 * - OpenClaw's bundled skills: every `*skills` directory of the global
 *   `openclaw` package.
 *
 * Configured paths starting `~` or `~/` are resolved against the home
 * directory. Roots are deduplicated by {@link pathKey} (case-folded only
 * on Windows). A skill is a directory holding `SKILL.md`; its origin
 * comes from `origins.ts`. Missing roots are skipped.
 */

import path from 'node:path';

import { z } from 'zod';

import { parseSkillFrontmatter } from './frontmatter.js';
import {
  classifyOrigin,
  embeddedSkillNames,
  type SkillOrigin,
  type SkillRootKind,
} from './origins.js';
import { pathKey, type SkillFs, walkFiles } from './skill-fs.js';

/** The parts of `openclaw.json` the inventory reads. */
const openclawSkillsConfigSchema = z.looseObject({
  skills: z
    .looseObject({
      load: z
        .looseObject({ extraDirs: z.array(z.string()).optional() })
        .optional(),
    })
    .optional(),
  agents: z
    .looseObject({
      defaults: z.looseObject({ workspace: z.string().optional() }).optional(),
      list: z
        .array(z.looseObject({ workspace: z.string().optional() }))
        .optional(),
    })
    .optional(),
});

/** Where the inventory looks. */
export interface InventoryEnv {
  /** File system port. */
  fs: SkillFs;
  /** OpenClaw's state directory (`~/.openclaw`). */
  stateDir: string;
  /** The global npm `node_modules` holding `openclaw` (`undefined`: not found, so no bundled or jeeves-tools skills). */
  globalModulesDir: string | undefined;
  /** The user's home directory (for `~` in configured paths). */
  homeDir: string;
  /** The parsed `openclaw.json` (`undefined` when there is none). */
  openclawConfig: unknown;
}

/** A directory of skills and what kind it is. */
export interface SkillRoot {
  /** Absolute directory. */
  dir: string;
  /** Root kind (drives the origin outside a package). */
  kind: SkillRootKind;
}

/** One skill in the inventory. */
export interface InventorySkill {
  /** Skill name (frontmatter `name`, else the directory name). */
  name: string;
  /** Frontmatter description (`''` when missing). */
  description: string;
  /** Origin label. */
  origin: SkillOrigin;
  /** Absolute SKILL.md path. */
  file: string;
  /** SKILL.md size in bytes. */
  bytes: number;
  /** SKILL.md modification time (ms), when known. */
  mtimeMs?: number;
  /** Full SKILL.md text. */
  text: string;
}

/**
 * A configured path with a leading `~` (alone, or before a separator:
 * `/`, or on Windows also `\`) resolved against the home directory;
 * `~user` and other paths unchanged.
 *
 * @param p - The configured path.
 * @param homeDir - The home directory.
 * @returns The path.
 */
const expandHome = (p: string, homeDir: string): string =>
  p === '~' || p.startsWith('~/') || p.startsWith(`~${path.sep}`)
    ? path.join(homeDir, p.slice(1))
    : p;

/**
 * Every skill root to scan, deduplicated, in precedence-free order.
 *
 * @param env - Inventory environment.
 * @returns The roots.
 */
export function skillRoots(env: InventoryEnv): SkillRoot[] {
  const parsed = openclawSkillsConfigSchema.safeParse(env.openclawConfig ?? {});
  const config = parsed.success ? parsed.data : {};
  const { fs: skillFs, stateDir, homeDir } = env;
  const agentsDir = path.join(stateDir, 'agents');
  const workspaces = [
    config.agents?.defaults?.workspace,
    ...(config.agents?.list ?? []).map((a) => a.workspace),
    path.join(stateDir, 'workspace'),
  ]
    .filter((w): w is string => typeof w === 'string' && w !== '')
    .map((w) => expandHome(w, homeDir));
  const bundled = (modules: string): SkillRoot[] => {
    const openclawPkg = path.join(modules, 'openclaw');
    return skillFs
      .listDirs(openclawPkg)
      .filter((d) => d.endsWith('skills'))
      .map((d) => ({ dir: path.join(openclawPkg, d), kind: 'bundled' }));
  };
  const roots: SkillRoot[] = [
    ...skillFs.listDirs(agentsDir).map((agent) => ({
      dir: path.join(agentsDir, agent, 'agent', 'workshop-skills'),
      kind: 'workshop' as const,
    })),
    ...(config.skills?.load?.extraDirs ?? []).map((dir) => ({
      dir: expandHome(dir, homeDir),
      kind: 'extra' as const,
    })),
    { dir: path.join(stateDir, 'skills'), kind: 'managed' },
    { dir: path.join(stateDir, 'plugin-skills'), kind: 'plugin' },
    ...workspaces.map((w) => ({
      dir: path.join(w, 'skills'),
      kind: 'workspace' as const,
    })),
    ...(env.globalModulesDir === undefined
      ? []
      : bundled(env.globalModulesDir)),
  ];
  const seen = new Set<string>();
  return roots.filter((r) => {
    const key = pathKey(r.dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Skill names the installed jeeves-tools package ships (embedded in its
 * built modules); empty when it isn't installed.
 *
 * @param env - Inventory environment.
 * @returns The names.
 */
export function jeevesToolsSkillNames(env: InventoryEnv): Set<string> {
  const names = new Set<string>();
  if (env.globalModulesDir === undefined) return names;
  const dist = path.join(
    env.globalModulesDir,
    '@karmaniverous',
    'jeeves-tools',
    'dist',
  );
  for (const rel of walkFiles(env.fs, dist)) {
    if (!rel.endsWith('.js')) continue;
    const text = env.fs.readText(path.join(dist, rel)) ?? '';
    for (const name of embeddedSkillNames(text)) names.add(name);
  }
  return names;
}

/**
 * Read the whole skill inventory.
 *
 * @param env - Inventory environment.
 * @returns Every skill found, sorted by name then origin.
 */
export function readInventory(env: InventoryEnv): InventorySkill[] {
  const toolsSkills = jeevesToolsSkillNames(env);
  const skills: InventorySkill[] = [];
  for (const root of skillRoots(env)) {
    for (const dirName of env.fs.listDirs(root.dir)) {
      const file = path.join(root.dir, dirName, 'SKILL.md');
      const text = env.fs.readText(file);
      if (text === undefined) continue;
      const fm = parseSkillFrontmatter(text);
      const name = fm.name ?? dirName;
      const mtimeMs = env.fs.mtimeMs(file);
      skills.push({
        name,
        description: fm.description ?? '',
        origin: classifyOrigin(file, root.kind, name, toolsSkills),
        file,
        bytes: Buffer.byteLength(text),
        ...(mtimeMs === undefined ? {} : { mtimeMs }),
        text,
      });
    }
  }
  return skills.sort(
    (a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin),
  );
}
