/**
 * @module cli/openclaw
 *
 * The `openclaw` CLI as `skills` and `init` use it (design §8): read a
 * config path, apply a batch of sets atomically, unset a path, and check
 * that `openclaw` is on the host. The pattern follows the jeeves CLI's
 * plugin config patch:
 * `openclaw config get <path> --json`,
 * `openclaw config set --batch-file <file>` and
 * `openclaw config unset <path>`, so OpenClaw validates and writes its
 * own config. Spawns through
 * cross-spawn (Windows `.cmd` shims). Commands run behind a
 * {@link RunCommand} seam so tests use a fake `openclaw`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';
import { z } from 'zod';

/** The OpenClaw CLI binary. */
export const OPENCLAW = 'openclaw';

/** A finished command. */
export interface CommandResult {
  /** Exit code. */
  code: number;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
}

/** Runs a command; rejects only when it can't start (e.g. not installed). */
export type RunCommand = (
  command: string,
  args: readonly string[],
) => Promise<CommandResult>;

/** Run a command, capturing its output. */
export const runCommand: RunCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

/** One `openclaw config set` operation. */
export interface ConfigSet {
  /** Dotted config path. */
  path: string;
  /** JSON value. */
  value: unknown;
}

const failure = (what: string, r: CommandResult) =>
  new Error(
    `${what} failed (exit ${String(r.code)}): ${(r.stderr || r.stdout).trim()}`,
  );

/** Whether `openclaw` runs on this host. */
export const openclawPresent = async (
  run: RunCommand = runCommand,
): Promise<boolean> => {
  try {
    return (await run(OPENCLAW, ['--version'])).code === 0;
  } catch {
    return false;
  }
};

/**
 * Read a config path as JSON; `undefined` when it is unset.
 *
 * @throws When `openclaw` fails for another reason.
 */
export const configGet = async (
  configPath: string,
  run: RunCommand = runCommand,
): Promise<unknown> => {
  const r = await run(OPENCLAW, ['config', 'get', configPath, '--json']);
  if (r.code === 0) return JSON.parse(r.stdout) as unknown;
  if ((r.stdout + r.stderr).includes('valid but unset')) return undefined;
  throw failure(`openclaw config get ${configPath}`, r);
};

/**
 * Apply sets in one `openclaw config set --batch-file` call (atomic).
 *
 * @throws When `openclaw config set` fails.
 */
export const configSetBatch = async (
  sets: readonly ConfigSet[],
  run: RunCommand = runCommand,
): Promise<void> => {
  if (sets.length === 0) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeeves-scripts-'));
  const file = path.join(dir, 'config-set.batch.json');
  try {
    fs.writeFileSync(file, JSON.stringify(sets));
    const r = await run(OPENCLAW, ['config', 'set', '--batch-file', file]);
    if (r.code !== 0) throw failure('openclaw config set', r);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Unset a config path.
 *
 * @throws When `openclaw config unset` fails.
 */
export const configUnset = async (
  configPath: string,
  run: RunCommand = runCommand,
): Promise<void> => {
  const r = await run(OPENCLAW, ['config', 'unset', configPath]);
  if (r.code !== 0) throw failure(`openclaw config unset ${configPath}`, r);
};

const skillsListSchema = z.object({
  skills: z.array(z.looseObject({ name: z.string(), source: z.string() })),
});

/**
 * The source of each skill OpenClaw loads (`openclaw skills list --json`),
 * by name.
 *
 * @throws When `openclaw skills list` fails or prints something else.
 */
export const skillSources = async (
  run: RunCommand = runCommand,
): Promise<Map<string, string>> => {
  const r = await run(OPENCLAW, ['skills', 'list', '--json']);
  if (r.code !== 0) throw failure('openclaw skills list', r);
  const { skills } = skillsListSchema.parse(
    JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))),
  );
  return new Map(skills.map((s) => [s.name, s.source]));
};
