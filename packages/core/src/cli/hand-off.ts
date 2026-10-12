/**
 * @module cli/hand-off
 *
 * The package `bin` as a hand-off (R27, Decision 39; design §9). Installed
 * globally (or run with `npx`), `jeeves-scripts` finds the scripts repo by
 * a leading `--dir <path>`, then `JEEVES_SCRIPTS_DIR`, then the nearest
 * `jeeves-scripts.json` at or above the working directory, and runs that
 * repo's launcher (`bin/jeeves-scripts.js`) with the rest of the command
 * line, so the repo's pinned core runs. With no repo (or one without a
 * launcher yet) it runs only `init`, `--help` and `--version` itself, in
 * the named directory or the working directory, and otherwise exits 1
 * saying how to point it at a repo. A repo whose launcher exists but whose
 * core isn't installed yet (`init` done, `npm install` not) is treated
 * the same, and the error says to run `npm install` there (Decision 57).
 * Runner jobs never use it.
 *
 * Reads the filesystem and the environment; spawns `node` for the
 * launcher.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { main } from './index.js';
import { CORE_PACKAGE } from './package-info.js';

/** The file that marks a scripts repo. */
export const REPO_MARKER = 'jeeves-scripts.json';

/** The launcher, relative to the repo root. */
export const LAUNCHER = path.join('bin', 'jeeves-scripts.js');

/** The env var naming the scripts repo root. */
export const DIR_ENV = 'JEEVES_SCRIPTS_DIR';

/** What runs without a repo. */
const STANDALONE = new Set(['init', '--help', '-h', '--version', '-V']);

/** Whether `repo` resolves core (its `npm install` has run). */
export const coreInstalled = (repo: string): boolean => {
  try {
    createRequire(path.join(repo, 'package.json')).resolve(
      `${CORE_PACKAGE}/package.json`,
    );
    return true;
  } catch {
    return false;
  }
};

/** Where a command line goes. */
export interface Located {
  /** The repo whose launcher runs the command, if found. */
  launcher?: string;
  /** The root for a command run here (no launcher). */
  root: string;
  /** The command line without the hand-off's own `--dir`. */
  args: string[];
}

/**
 * Split a leading `--dir <path>` or `--dir=<path>` off the command line.
 * Only before the verb, so a runnable's own arguments are never taken.
 *
 * @throws When `--dir` has no value.
 */
export const splitDir = (
  args: readonly string[],
): { dir?: string; args: string[] } => {
  const [first, ...rest] = args;
  if (first !== '--dir' && !first?.startsWith('--dir='))
    return { args: [...args] };
  const dir = first === '--dir' ? rest.shift() : first.slice('--dir='.length);
  if (!dir) throw new Error('--dir needs a path: --dir <path>');
  return { dir, args: rest };
};

/** The nearest directory at or above `start` holding `jeeves-scripts.json`. */
export const findRepo = (start: string): string | undefined => {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, REPO_MARKER))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
};

/**
 * Locate the repo for a command line.
 *
 * @throws When `--dir` has no value.
 */
export const locate = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Located => {
  const { dir, args } = splitDir(argv);
  const fromEnv = env[DIR_ENV];
  const named = dir ?? (fromEnv === '' ? undefined : fromEnv);
  const base = named === undefined ? cwd : path.resolve(cwd, named);
  const repo = named === undefined ? findRepo(cwd) : base;
  const launcher = repo === undefined ? undefined : path.join(repo, LAUNCHER);
  return launcher !== undefined && fs.existsSync(launcher)
    ? { launcher, root: repo ?? base, args }
    : { root: repo ?? base, args };
};

/** Seams for tests. */
export interface HandOffOptions {
  /** Environment. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Working directory. Default: `process.cwd()`. */
  cwd?: string;
  /** Runs the repo's launcher; resolves to its exit code. */
  delegate?: (launcher: string, args: readonly string[]) => Promise<number>;
  /** Runs the CLI here; resolves to its exit code. */
  run?: (root: string, args: readonly string[]) => Promise<number>;
  /** Prints an error line. */
  error?: (line: string) => void;
  /** Whether a repo has core installed. Default: {@link coreInstalled}. */
  installed?: (repo: string) => boolean;
}

/** Run `node <launcher> ...args` with this terminal; resolves to its exit code. */
export const runLauncher = (
  launcher: string,
  args: readonly string[],
): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, ...args], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

/** Hand a command line to the right repo; resolves to the exit code. */
export const handOff = async (
  argv: readonly string[],
  options: HandOffOptions = {},
): Promise<number> => {
  const error = options.error ?? console.error;
  let located: Located;
  try {
    located = locate(argv, options.env, options.cwd);
  } catch (e) {
    error(`jeeves-scripts: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const { launcher, root, args } = located;
  const uninstalled =
    launcher !== undefined && !(options.installed ?? coreInstalled)(root);
  if (launcher !== undefined && !uninstalled)
    return (options.delegate ?? runLauncher)(launcher, args);
  if (args[0] === undefined || STANDALONE.has(args[0]))
    return (
      options.run ??
      ((r, a) => main({ root: r, argv: ['node', 'jeeves-scripts', ...a] }))
    )(root, args);
  error(
    uninstalled
      ? `jeeves-scripts: ${root} has no installed ${CORE_PACKAGE} yet: run npm install there first. Until then, only init, --help and --version run.`
      : `jeeves-scripts: no scripts repo found from ${root}. Pass --dir <path>, set ${DIR_ENV}, or run inside a repo (a directory with ${REPO_MARKER} and ${LAUNCHER}). Without one, only init, --help and --version run.`,
  );
  return 1;
};
