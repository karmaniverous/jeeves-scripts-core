/**
 * @module cli/skills
 *
 * `jeeves-scripts skills install | uninstall | status` (R31, Decision 37;
 * design §8): wires core's shipped skills into OpenClaw without copying
 * them. `install` adds `<root>/node_modules/@karmaniverous/jeeves-scripts-core/skills`
 * to `skills.load.extraDirs` (exact match, idempotent) and sets
 * `skills.entries.<skill>.env.JEEVES_SCRIPTS_DIR` to the repo root for
 * each shipped skill. `uninstall` removes exactly those entries. `status`
 * reports wired, missing and stale entries, and core skills a
 * same-named skill from another source shadows.
 *
 * `install` and `uninstall` show the change and ask before applying it,
 * unless `--yes`; without a terminal to ask on, they apply nothing and
 * print the command to run. Reads and writes OpenClaw's config only
 * through the `openclaw` CLI (`cli/openclaw`); what each command changes
 * is cli/skills-change.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

import {
  configGet,
  configSetBatch,
  configUnset,
  type RunCommand,
  runCommand,
  skillSources,
} from './openclaw.js';
import { CORE_PACKAGE, corePackageDir } from './package-info.js';
import {
  describeChange,
  envValue,
  installChange,
  SKILLS_ENV,
  skillsConfigSchema,
  type SkillsContext,
  skillsDirFor,
  uninstallChange,
} from './skills-change.js';

/** The OpenClaw skill source of `skills.load.extraDirs`. */
const EXTRA_SOURCE = 'openclaw-extra';

/** The skill folders core ships, sorted. */
export const shippedSkills = (
  dir: string = path.join(corePackageDir(), 'skills'),
): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')),
    )
    .map((e) => e.name)
    .sort();

const isCoreSkillsDir = (dir: string): boolean =>
  dir
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .endsWith(`/node_modules/${CORE_PACKAGE}/skills`);

/**
 * The `status` report. `sources` is OpenClaw's source per loaded skill, or
 * the error listing them.
 */
export const statusLines = (
  { root, skills, config }: SkillsContext,
  sources: Map<string, string> | Error,
): string[] => {
  const dir = skillsDirFor(root);
  const value = path.resolve(root);
  const extraDirs = config?.load?.extraDirs ?? [];
  const lines = [
    `skills: ${dir}`,
    `  extraDirs: ${extraDirs.includes(dir) ? 'wired' : 'missing'}`,
    ...extraDirs
      .filter((d) => d !== dir && isCoreSkillsDir(d))
      .map((d) => `  extraDirs: stale (another core skills folder: ${d})`),
  ];
  if (sources instanceof Error)
    lines.push(`  skill sources: unavailable (${sources.message})`);
  for (const skill of skills) {
    const env = envValue(config, skill);
    const state =
      env === value
        ? 'wired'
        : env === undefined
          ? 'missing'
          : `stale (${SKILLS_ENV}=${JSON.stringify(env)})`;
    const source = sources instanceof Error ? undefined : sources.get(skill);
    const shadow =
      source !== undefined && source !== EXTRA_SOURCE
        ? `; shadowed by a ${source} skill`
        : '';
    lines.push(`  ${skill}: ${state}${shadow}`);
  }
  return lines;
};

/** Ask a yes/no question on the terminal; `false` without one. */
export const confirmOnTerminal = async (question: string): Promise<boolean> => {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
};

/** Options for {@link runSkills}. */
export interface SkillsOptions {
  /** The scripts repo root. */
  root: string;
  /** Apply without asking. */
  yes?: boolean;
  /** The shipped skill names. Default: the running core's. */
  skills?: readonly string[];
  /** Runs `openclaw` (tests). */
  run?: RunCommand;
  /** Asks before applying (tests). */
  confirm?: (question: string) => Promise<boolean>;
  /** Prints a line. */
  log?: (line: string) => void;
  /** Prints the failure line (stderr by default; design §12). */
  error?: (line: string) => void;
}

/**
 * Run `skills install | uninstall | status`; resolves to the exit code
 * (1 when `openclaw` fails).
 */
export const runSkills = async (
  action: 'install' | 'uninstall' | 'status',
  options: SkillsOptions,
): Promise<number> => {
  const run = options.run ?? runCommand;
  const log = options.log ?? console.log;
  try {
    const context: SkillsContext = {
      root: options.root,
      skills: options.skills ?? shippedSkills(),
      config: skillsConfigSchema.parse(await configGet('skills', run)),
    };
    if (action === 'status') {
      const sources = await skillSources(run).catch((e: unknown) =>
        e instanceof Error ? e : new Error(String(e)),
      );
      for (const line of statusLines(context, sources)) log(line);
      return 0;
    }
    const change = (action === 'install' ? installChange : uninstallChange)(
      context,
    );
    if (!change.sets.length && !change.unsets.length) {
      log(`skills ${action}: nothing to change`);
      return 0;
    }
    log(`skills ${action}: this changes OpenClaw's config:`);
    for (const line of describeChange(change)) log(line);
    const apply =
      options.yes === true ||
      (await (options.confirm ?? confirmOnTerminal)('Apply? [y/N] '));
    if (!apply) {
      log(
        `Not applied. To apply: node bin/jeeves-scripts.js skills ${action} --yes`,
      );
      return 0;
    }
    await configSetBatch(change.sets, run);
    for (const p of change.unsets) await configUnset(p, run);
    log(`skills ${action}: applied`);
    return 0;
  } catch (e) {
    (options.error ?? console.error)(
      `skills ${action}: FAILED: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
};
