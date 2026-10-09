/**
 * @module cli/run
 *
 * `jeeves-scripts run <job-id> [args...]` (Decision 16): the command runner
 * jobs execute through the instance launcher.
 *
 * Transitional job registry (Decision 32): the job is looked up by id in the
 * instance's `jobs/*.json`, whose `script` is a template-style path
 * (`src/<domain>/<name>.ts`). An instance-local script at that path wins
 * (JGS-only code, overrides); otherwise the same path is resolved to core's
 * built module (`dist/<domain>/<name>.js`). Core modules are imported in
 * this process, after the config location is pinned to the instance root,
 * so they read the instance's `jeeves-scripts.json`. Instance scripts are
 * TypeScript and run in a child `node --import tsx` process with the same
 * environment.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CONFIG_PATH_ENV } from '../config/loader.js';

/** A runner job definition, as far as `run` needs it. */
export interface JobDefinition {
  /** Job id (`jeeves-scripts run <id>`). */
  id: string;
  /** Script path relative to the instance root, e.g. `src/email/poll.ts`. */
  script: string;
}

/** Where a job's code lives. */
export type ResolvedJob =
  | { kind: 'instance'; job: JobDefinition; file: string }
  | { kind: 'core'; job: JobDefinition; file: string };

const isJob = (value: unknown): value is JobDefinition =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === 'string' &&
  typeof (value as Record<string, unknown>).script === 'string';

/** Every job defined in `{root}/jobs/*.json` (arrays of job objects). */
export const readJobs = (root: string): JobDefinition[] => {
  const dir = path.join(root, 'jobs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(dir, name), 'utf8'),
      );
      return Array.isArray(parsed) ? parsed.filter(isJob) : [];
    });
};

/** Core's built output directory (`dist/`), next to this module's parent. */
const coreDistDir = (): string =>
  path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Resolve a job id to the file that runs it.
 *
 * @param distDir - Core's module root. Default: this package's `dist/`.
 * @throws When the id is unknown or no file exists for its script.
 */
export const resolveJob = (
  root: string,
  jobId: string,
  distDir: string = coreDistDir(),
): ResolvedJob => {
  const job = readJobs(root).find((j) => j.id === jobId);
  if (!job)
    throw new Error(`Unknown job "${jobId}" (no entry in jobs/*.json).`);
  const local = path.join(root, job.script);
  if (fs.existsSync(local)) return { kind: 'instance', job, file: local };
  const rel = job.script.replace(/^src[\\/]/, '').replace(/\.ts$/, '.js');
  const built = path.join(distDir, rel);
  if (fs.existsSync(built)) return { kind: 'core', job, file: built };
  throw new Error(
    `Job "${jobId}": script ${job.script} is neither in the instance repo nor in core (${built}).`,
  );
};

/**
 * Run a job. Core modules run in this process; instance scripts run in a
 * child process. Resolves to the exit code for instance scripts; for core
 * modules, to 0 once the module has loaded (the job's own `runScript`
 * sets `process.exitCode` on failure).
 */
export const runJob = async (
  root: string,
  jobId: string,
  args: readonly string[],
  distDir?: string,
): Promise<number> => {
  const resolved = resolveJob(root, jobId, distDir);
  process.env[CONFIG_PATH_ENV] ??= path.join(root, 'jeeves-scripts.json');
  if (resolved.kind === 'instance') {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolved.file, ...args],
      { cwd: root, stdio: 'inherit', env: process.env },
    );
    return result.status ?? 1;
  }
  process.argv = [process.argv[0] ?? process.execPath, resolved.file, ...args];
  await import(pathToFileURL(resolved.file).href);
  return 0;
};
