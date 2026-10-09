#!/usr/bin/env node
/**
 * @module cli/config-check
 *
 * Minimal `jeeves-scripts-core-config-check` bin: runs {@link configCheck}
 * against a `jeeves-scripts.json`, given `--root <dir>` or
 * `--config <file>` (else `JEEVES_SCRIPTS_CONFIG`). Stands in for the
 * `config check` CLI command (Architecture → CLI) until the full
 * `jeeves-scripts` CLI exists (Dev Plan row 6). Built on
 * `@commander-js/extra-typings`, matching `jeeves-tools`, `jeeves` and
 * `get-dotenv`: options are inferred from the builder chain, never cast.
 */

import { Command } from '@commander-js/extra-typings';

import { configCheck } from '../config/check.js';

/** Build the `config-check` command. Exported so tests can `parseAsync` it. */
export const buildConfigCheckCommand = () =>
  new Command()
    .name('jeeves-scripts-core-config-check')
    .description(
      'Validate a jeeves-scripts.json config file against the core schema.',
    )
    .option(
      '--root <dir>',
      'instance repo root (resolves {root}/jeeves-scripts.json)',
    )
    .option('--config <file>', 'explicit config file path')
    .action((options) => {
      const result = configCheck({
        root: options.root,
        configPath: options.config,
      });
      if (result.ok) {
        console.log(
          `config check: OK (${result.configPath ?? 'unknown path'})`,
        );
        return;
      }
      console.error(
        `config check: FAILED (${result.configPath ?? 'unknown path'})`,
      );
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
    });

/** Entry point for the bin. Returns the process exit code. */
export const main = async (argv: string[] = process.argv): Promise<number> => {
  const command = buildConfigCheckCommand();
  await command.parseAsync(argv);
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
};

/* v8 ignore start -- exercised via unit tests calling main() directly */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => {
    process.exit(code);
  });
}
/* v8 ignore stop */
