/**
 * @module cli
 *
 * The `jeeves-scripts` CLI (Architecture → CLI). Built on
 * `@commander-js/extra-typings` (Decision 31): option and argument types
 * are inferred from the builder chain, never cast.
 *
 * The instance launcher (Decision 16) calls {@link main} with the instance
 * repo root, so config resolution never depends on the working directory
 * (Architecture → Config Resolution). Commands land here as their domains
 * are ported; this slice carries `config check`.
 */

import { fileURLToPath } from 'node:url';

import { Command } from '@commander-js/extra-typings';

import { configCheck } from '../config/check.js';

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

/** Build the `jeeves-scripts` program for an instance repo root. */
export const buildProgram = (options: CliOptions) => {
  const root = resolveRoot(options.root);
  return new Command('jeeves-scripts')
    .description('Run and manage jeeves-scripts jobs for this instance.')
    .addCommand(buildConfigCommand(root));
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
