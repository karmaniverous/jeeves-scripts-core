/**
 * @module cli
 *
 * The `jeeves-scripts` CLI (design §6). Built on
 * `@commander-js/extra-typings` (Decision 31): option and argument types
 * are inferred from the builder chain, never cast.
 *
 * The instance launcher (Decision 16) calls {@link main} with the instance
 * repo root, so config resolution never depends on the working directory
 * (design §5). The verbs are the framework's own
 * (R46): `run`, `list`, `config check|set|unset`, `doctor`, `init`, `skills`. Domain work is never a verb
 * (Decision 49): it is a runnable, run with `run <id>`.
 */

import { fileURLToPath } from 'node:url';

import { Command } from '@commander-js/extra-typings';

import { describeConfigSource } from '../config/check.js';
import { type ConfigEdit, parseConfigValue } from '../config/edit.js';
import { wantsHelp } from '../runnables/job-help.js';
import { instanceConfigCheck } from './config-check.js';
import { configEdit } from './config-edit.js';
import { doctorReport } from './doctor.js';
import { describeError, formatInit, initRepo } from './init.js';
import { formatList, jobHelp, listRunnables } from './list.js';
import { openclawPresent } from './openclaw.js';
import { coreVersion } from './package-info.js';
import { runJob } from './run.js';
import { runSkills } from './skills.js';

/** Options for {@link buildProgram} and {@link main}. */
export interface CliOptions {
  /** Instance repo root: a path, or a `file:` URL as the launcher passes it. */
  root: string | URL;
}

/** Normalise a launcher-supplied root (`string` path or `file:` URL). */
export const resolveRoot = (root: string | URL): string =>
  typeof root === 'string' ? root : fileURLToPath(root);

/** An error as one line: its message (a Zod error's issues joined), no stack. */
export const errorLine = (e: unknown): string =>
  describeError(e)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

/** Print `<verb>: FAILED: <error>` to stderr and set the exit code to 1. */
const fail = (verb: string, e: unknown): void => {
  console.error(`${verb}: FAILED: ${errorLine(e)}`);
  process.exitCode = 1;
};

const buildConfigCommand = (root: string) => {
  const config = new Command('config')
    .description('Validate and edit the instance config.')
    // No `help [command]` subcommand anywhere (Decision 57).
    .helpCommand(false);

  config
    .command('check')
    .description(
      "Validate jeeves-scripts.json against the core schema and its silo references, its local block against the plugin's configSchema, and the plugin's runnables, the instance manifests and the jobs deltas as list registers them.",
    )
    .option(
      '--config <file>',
      'config file: a full config or a pointer (default: JEEVES_SCRIPTS_CONFIG, else {root}/jeeves-scripts.json)',
    )
    .action(async (options) => {
      const result = await instanceConfigCheck(root, options.config);
      const from = describeConfigSource(result.source);
      const where =
        result.configPath === undefined
          ? ''
          : ` (${result.configPath}${from ? `, from ${from}` : ''})`;
      if (result.ok) {
        console.log(`config check: OK${where}`);
        return;
      }
      console.error(`config check: FAILED${where}`);
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
    });

  /** Run one edit and print its outcome. */
  const runEdit = async (
    path: string,
    edit: ConfigEdit,
    options: { live?: boolean; config?: string },
  ) => {
    const result = await configEdit(root, {
      path,
      edit,
      live: options.live === true,
      configPath: options.config,
    });
    for (const line of result.lines) console.log(line);
    for (const error of result.errors) console.error(error);
    if (!result.ok) process.exitCode = 1;
  };
  const configOption =
    'config file: a pointer or a full config outside the repo (default: JEEVES_SCRIPTS_CONFIG, else {root}/jeeves-scripts.json)';

  config
    .command('set')
    .description(
      'Set a value in the instance config (dry run unless --live): <path> is dotted (slack.channels.C0123.homeDir; keys with dots as ["a.b"]), <value> is JSON, else a string. The result is validated like config check; --live backs the file up first (newest 20 kept) and writes atomically.',
    )
    .argument('<path>', 'config path')
    .argument('<value>', 'JSON value, else a string')
    .option('--live', 'write the change (default: dry run)')
    .option('--config <file>', configOption)
    .action(async (path, value, options) => {
      await runEdit(path, { set: parseConfigValue(value) }, options);
    });

  config
    .command('unset')
    .description(
      'Remove a key from the instance config (dry run unless --live), validated and written like config set.',
    )
    .argument('<path>', 'config path')
    .option('--live', 'write the change (default: dry run)')
    .option('--config <file>', configOption)
    .action(async (path, options) => {
      await runEdit(path, { unset: true }, options);
    });

  return config;
};

const buildRunCommand = (root: string) =>
  new Command('run')
    .description(
      'Run a runnable by id: a plugin override, else the core runnable, else the instance runnable.',
    )
    .argument('<id>', 'runnable id (see list)')
    .argument(
      '[args...]',
      'arguments for the runnable, checked against the flags it declares (run <id> --help)',
    )
    .allowUnknownOption()
    .passThroughOptions()
    .action(async (jobId, args) => {
      try {
        if (wantsHelp(args)) {
          console.log(await jobHelp(root, jobId));
          return;
        }
        const code = await runJob(root, jobId, args);
        if (code !== 0) process.exitCode = code;
      } catch (e) {
        fail('run', e);
      }
    });

const buildListCommand = (root: string) =>
  new Command('list')
    .description(
      'List registered runnables (core and instance) whose id matches the glob, with source, effective schedule, enabled and description.',
    )
    .argument('[glob]', 'shell-style glob matched against the id', '*')
    .option('--json', 'print JSON, adding domain and the effective manifest')
    .action(async (glob, options) => {
      let entries;
      try {
        entries = await listRunnables(root, glob);
      } catch (e) {
        fail('list', e);
        return;
      }
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

const buildInitCommand = (root: string) =>
  new Command('init')
    .description(
      "Write an instance repo here from the template bundled in core, and its config.json in --config-dir (the repo's jeeves-scripts.json points at it). Never overwrites a file.",
    )
    .requiredOption(
      '--config-dir <dir>',
      'config directory, outside the repo (e.g. J:/config/jeeves-scripts)',
    )
    .option('--name <pkg>', 'package name (default: the folder name)')
    .option(
      '--core <version>',
      'exact core version to pin (default: the running core version)',
    )
    .action(async (options) => {
      try {
        for (const line of formatInit(root, initRepo(root, options)))
          console.log(line);
      } catch (e) {
        fail('init', e);
        return;
      }
      if (await openclawPresent()) {
        if ((await runSkills('install', { root })) !== 0) process.exitCode = 1;
      } else
        console.log(
          'OpenClaw is not on this host. To wire core skills into it later: node bin/jeeves-scripts.js skills install',
        );
    });

const SKILLS_ACTIONS = {
  install:
    'Add core skills to OpenClaw (skills.load.extraDirs, and JEEVES_SCRIPTS_DIR for each skill).',
  uninstall: "Remove exactly this repo's core skills entries from OpenClaw.",
  status: 'Report wired, missing, stale and shadowed core skills entries.',
} as const;

const buildSkillsCommand = (root: string) => {
  const command = new Command('skills')
    .description('Wire core skills into OpenClaw through openclaw config set.')
    // No `help [command]` subcommand anywhere (Decision 57).
    .helpCommand(false);
  for (const [action, description] of Object.entries(SKILLS_ACTIONS) as [
    keyof typeof SKILLS_ACTIONS,
    string,
  ][]) {
    const sub = new Command(action).description(description);
    if (action !== 'status')
      sub.option('-y, --yes', 'apply without showing the change and asking');
    command.addCommand(
      sub.action(async (options: { yes?: boolean }) => {
        const code = await runSkills(action, { root, yes: options.yes });
        if (code !== 0) process.exitCode = code;
      }),
    );
  }
  return command;
};

/** Build the `jeeves-scripts` program for an instance repo root. */
export const buildProgram = (options: CliOptions) => {
  const root = resolveRoot(options.root);
  return (
    new Command('jeeves-scripts')
      .description('Run and list jeeves-scripts runnables for this instance.')
      .version(coreVersion(), '-V, --version', 'print the core version')
      .addHelpText(
        'after',
        '\nInstalled globally, jeeves-scripts finds the scripts repo by a leading --dir <path>, then JEEVES_SCRIPTS_DIR, then the nearest jeeves-scripts.json above the working directory, and runs its bin/jeeves-scripts.js.',
      )
      .enablePositionalOptions()
      // `--help` is the help; no `help` verb (R46, design section 9).
      .helpCommand(false)
      .addCommand(buildConfigCommand(root))
      .addCommand(buildRunCommand(root))
      .addCommand(buildListCommand(root))
      .addCommand(buildDoctorCommand(root))
      .addCommand(buildInitCommand(root))
      .addCommand(buildSkillsCommand(root))
  );
};

/**
 * CLI entry point. Parses `argv` (default `process.argv`) and resolves to
 * the exit code: a verb's failure (an unknown id, a registration, manifest
 * or delta error) is one `<verb>: FAILED: ...` line on stderr and exit code
 * 1, never a rejection or a stack trace. It never calls `process.exit`
 * itself; Commander's own parse errors (an unknown verb or option, a
 * missing argument) print Commander's message and exit 1 through
 * Commander.
 */
export const main = async (
  options: CliOptions & { argv?: readonly string[] },
): Promise<number> => {
  const program = buildProgram(options);
  try {
    await program.parseAsync(options.argv ?? process.argv);
  } catch (e) {
    fail('jeeves-scripts', e);
  }
  return typeof process.exitCode === 'number' ? process.exitCode : 0;
};
