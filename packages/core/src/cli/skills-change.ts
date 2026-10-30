/**
 * @module cli/skills-change
 *
 * What `skills install` and `skills uninstall` change in OpenClaw's
 * config (cli/skills): the `skills` block as far as they read it, and
 * the sets and unsets each one makes. Pure; cli/skills reads and writes
 * the config.
 */

import path from 'node:path';

import { z } from 'zod';

import type { ConfigSet } from './openclaw.js';
import { CORE_PACKAGE } from './package-info.js';

/** The env var each shipped skill declares: the scripts repo root. */
export const SKILLS_ENV = 'JEEVES_SCRIPTS_DIR';

/** The OpenClaw config path of the extra skill folders. */
const EXTRA_DIRS = 'skills.load.extraDirs';

/** The skills folder of the core installed in a scripts repo. */
export const skillsDirFor = (root: string): string =>
  path.join(
    path.resolve(root),
    'node_modules',
    ...CORE_PACKAGE.split('/'),
    'skills',
  );

/** OpenClaw's `skills` block, as far as these commands read it. */
export const skillsConfigSchema = z
  .looseObject({
    load: z
      .looseObject({ extraDirs: z.array(z.string()).optional() })
      .optional(),
    entries: z
      .record(
        z.string(),
        z
          .looseObject({ env: z.record(z.string(), z.unknown()).optional() })
          .nullable(),
      )
      .optional(),
  })
  .optional();

/** OpenClaw's `skills` config block, as far as this command reads it. */
export type SkillsConfig = z.output<typeof skillsConfigSchema>;

/** What a command works on. */
export interface SkillsContext {
  /** The scripts repo root. */
  root: string;
  /** The shipped skill names. */
  skills: readonly string[];
  /** OpenClaw's current `skills` block (`undefined` when unset). */
  config: SkillsConfig;
}

/** A change to OpenClaw's config: sets applied in one batch, then unsets. */
export interface SkillsChange {
  /** Paths to set. */
  sets: ConfigSet[];
  /** Paths to unset. */
  unsets: string[];
}

const envPath = (skill: string) => `skills.entries.${skill}.env.${SKILLS_ENV}`;

/** A shipped skill's `JEEVES_SCRIPTS_DIR` value in the config. */
export const envValue = (config: SkillsConfig, skill: string): unknown =>
  config?.entries?.[skill]?.env?.[SKILLS_ENV];

/** The change `install` makes (empty when everything is wired). */
export const installChange = ({
  root,
  skills,
  config,
}: SkillsContext): SkillsChange => {
  const dir = skillsDirFor(root);
  const value = path.resolve(root);
  const extraDirs = config?.load?.extraDirs ?? [];
  const sets: ConfigSet[] = [];
  if (!extraDirs.includes(dir))
    sets.push({ path: EXTRA_DIRS, value: [...extraDirs, dir] });
  for (const skill of skills)
    if (envValue(config, skill) !== value)
      sets.push({ path: envPath(skill), value });
  return { sets, unsets: [] };
};

/** Whether `object` holds nothing but `key`. */
const onlyKey = (object: object | null | undefined, key: string): boolean =>
  object !== null &&
  object !== undefined &&
  Object.keys(object).length === 1 &&
  key in object;

/**
 * The path to unset to remove a skill's env var: the var itself, or the
 * `env` object when the var is all it holds, or the whole entry when that
 * `env` is all the entry holds (so no empty objects are left behind).
 */
const envUnset = (config: SkillsConfig, skill: string): string => {
  const entry = config?.entries?.[skill];
  if (!onlyKey(entry?.env, SKILLS_ENV)) return envPath(skill);
  return onlyKey(entry, 'env')
    ? `skills.entries.${skill}`
    : `skills.entries.${skill}.env`;
};

/**
 * The change `uninstall` makes: removes exactly this repo's entries, and
 * any object (`skills.load`, an entry, its `env`, `skills.entries`) that
 * removing them would leave empty.
 */
export const uninstallChange = ({
  root,
  skills,
  config,
}: SkillsContext): SkillsChange => {
  const dir = skillsDirFor(root);
  const value = path.resolve(root);
  const extraDirs = config?.load?.extraDirs ?? [];
  const change: SkillsChange = { sets: [], unsets: [] };
  if (extraDirs.includes(dir)) {
    const rest = extraDirs.filter((d) => d !== dir);
    if (rest.length) change.sets.push({ path: EXTRA_DIRS, value: rest });
    else
      change.unsets.push(
        onlyKey(config?.load, 'extraDirs') ? 'skills.load' : EXTRA_DIRS,
      );
  }
  const unsets = skills
    .filter((skill) => envValue(config, skill) === value)
    .map((skill) => envUnset(config, skill));
  const entries = Object.keys(config?.entries ?? {});
  const whole = new Set(
    unsets.filter((p) => /^skills\.entries\.[^.]+$/.test(p)),
  );
  if (
    entries.length > 0 &&
    entries.every((skill) => whole.has(`skills.entries.${skill}`))
  )
    change.unsets.push(
      'skills.entries',
      ...unsets.filter((p) => !whole.has(p)),
    );
  else change.unsets.push(...unsets);
  return change;
};

/** A change as lines to show before applying it. */
export const describeChange = (change: SkillsChange): string[] => [
  ...change.sets.map((s) => `  set   ${s.path} = ${JSON.stringify(s.value)}`),
  ...change.unsets.map((p) => `  unset ${p}`),
];
