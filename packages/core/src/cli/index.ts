/**
 * @module cli
 *
 * The `jeeves-scripts` CLI (Architecture → CLI). Built on
 * `@commander-js/extra-typings` (Decision 31): option and argument types
 * are inferred from the builder chain, never cast.
 *
 * The instance launcher (Decision 16) calls {@link main} with the instance
 * repo root, so config resolution never depends on the working directory
 * (Architecture → Config Resolution). The verbs are the framework's own
 * (R46): `run`, `list`, `config check`, `doctor`. Domain work is never a verb
 * (Decision 49): it is a runnable, run with `run <id>`.
 */

import { fileURLToPath } from 'node:url';

import { Command } from '@commander-js/extra-typings';

import { configCheck } from '../config/check.js';
import { doctorReport } from './doctor.js';
import { formatList, listRunnables } from './list.js';
import { runJob } from './run.js';

/** Options for {@link buildProgram} and {@link main}. */
export interface CliOptions {
  /** Instance repo root: a path, or a `file:` URL as the launcher passes it. */
  root: string | URL;
}

/** Normalise a launcher-supplied root (`string` path or `file:` URL). */
export const resolveRoot = (root: string | URL): string =>
  typeof root === 'string' ? root : fileURLToPath(root);

const buildConfigCommand = (root: string) => {
  const config = new Command('config').description(
    'Validate and manage jeeves-scripts.json.',
  );

  config
    .command('check')
    .description(
      'Validate jeeves-scripts.json against the core schema and its silo references.',
    )
    .option(
      '--config <file>',
      'config file path (default: {root}/jeeves-scripts.json, or JEEVES_SCRIPTS_CONFIG)',
    )
    .action((options) => {
      const result = configCheck({ root, configPath: options.config });
      const where = result.configPath ?? 'unresolved path';
      if (result.ok) {
        console.log(`config check: OK (${where})`);
        return;
      }
      console.error(`config check: FAILED (${where})`);
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
    });

  return config;
};

const buildRunCommand = (root: string) =>
  new Command('run')
    .description(
      'Run a runnable by id: a plugin override, else the core runnable, else the instance runnable.',
    )
    .argument('<id>', 'runnable id (see list)')
    .argument('[args...]', 'arguments passed to the runnable unchanged')
    .allowUnknownOption()
    .passThroughOptions()
    .action(async (jobId, args) => {
      const code = await runJob(root, jobId, args);
      if (code !== 0) process.exitCode = code;
    });

const buildListCommand = (root: string) =>
  new Command('list')
    .description(
      'List registered runnables (core and instance) whose id matches the glob, with source, effective schedule, enabled and description.',
    )
    .argument('[glob]', 'shell-style glob matched against the id', '*')
    .option('--json', 'print JSON, adding domain and the effective manifest')
    .action(async (glob, options) => {
      const entries = await listRunnables(root, glob);
      if (options.json) console.log(JSON.stringify(entries, null, 2));
      else for (const line of formatList(entries)) console.log(line);
    });

const buildDoctorCommand = (root: string) =>
  new Command('doctor')
    .description(
      'Report the core version, config, plugin load, manifest prerequisites and override drift. Informational: always exits 0.',
    )
    .action(async () => {
      for (const line of await doctorReport(root)) console.log(line);
    });

/** Build the `jeeves-scripts` program for an instance repo root. */
export const buildProgram = (options: CliOptions) => {
  const root = resolveRoot(options.root);
  return new Command('jeeves-scripts')
    .description('Run and list jeeves-scripts runnables for this instance.')
    .enablePositionalOptions()
    .addCommand(buildConfigCommand(root))
    .addCommand(buildRunCommand(root))
    .addCommand(buildListCommand(root))
    .addCommand(buildDoctorCommand(root));
};

/**
 * CLI entry point. Parses `argv` (default `process.argv`) and resolves to
 * the exit code; it never calls `process.exit` itself.
 */
export const main = async (
  options: CliOptions & { argv?: readonly string[] },
): Promise<number> => {
  const program = buildProgram(options);
  await program.parseAsync(options.argv ?? process.argv);
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
};
