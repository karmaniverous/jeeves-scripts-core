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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from '@commander-js/extra-typings';

import { configCheck } from '../config/check.js';
import { loadConfig } from '../config/loader.js';
import { slackBotTokens } from '../lib/openclaw-config.js';
import { proposeFromSlack } from '../people/propose.js';
import { accountTeams } from '../slack/lib/account-teams.js';
import { readJsonFile, seedChannelCache } from '../slack/lib/cache-seed.js';
import {
  channelCacheFile,
  loadChannelCache,
  saveChannelCache,
} from '../slack/lib/slack-cache.js';
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
      "Run a job by id (Decision 16): the instance script at its jobs/*.json path, else core's module for that path.",
    )
    .argument('<job-id>', 'job id from jobs/*.json')
    .argument('[args...]', 'arguments passed to the job')
    .allowUnknownOption()
    .passThroughOptions()
    .action(async (jobId, args) => {
      const code = await runJob(root, jobId, args);
      if (code !== 0) process.exitCode = code;
    });

const buildPeopleCommand = () => {
  const people = new Command('people').description(
    'Work with the people registry (people in jeeves-scripts.json).',
  );
  people
    .command('propose')
    .description(
      'Read Slack users of every gateway bot account (read-only) and print a proposed people block. Never writes config.',
    )
    .option('--all', 'include people with a single account')
    .option('--out <file>', 'also write the proposal (UTF-8 JSON) to this file')
    .action(async (options) => {
      if (options.out && path.basename(options.out) === 'jeeves-scripts.json')
        throw new Error('people propose never writes jeeves-scripts.json');
      const proposal = await proposeFromSlack({ all: options.all });
      const json = `${JSON.stringify(proposal, null, 2)}\n`;
      if (options.out) fs.writeFileSync(options.out, json, 'utf8');
      process.stdout.write(json);
    });
  return people;
};

const buildSlackCommand = (root: string) => {
  const slack = new Command('slack').description('Slack pipeline maintenance.');
  slack
    .command('seed-cache')
    .description(
      "One-time switchover: carry each channel's account and workspace from the old channels.json and slack-channel-workspaces.json into the Slack cache ({stateDir}/slack/channels.json). Never overwrites cached values; reads the old files only.",
    )
    .requiredOption('--channels <file>', 'the old committed channels.json')
    .requiredOption(
      '--workspaces <file>',
      'the old slack-channel-workspaces.json',
    )
    .option('--dry-run', 'report what would change without writing')
    .action(async (options) => {
      loadConfig({ root });
      const cache = loadChannelCache();
      const result = seedChannelCache(
        cache,
        readJsonFile(options.channels),
        readJsonFile(options.workspaces),
        await accountTeams(slackBotTokens()),
      );
      if (!options.dryRun) saveChannelCache(cache);
      process.stdout.write(
        `${JSON.stringify({ ...result, file: channelCacheFile(), written: !options.dryRun })}\n`,
      );
    });
  return slack;
};

/** Build the `jeeves-scripts` program for an instance repo root. */
export const buildProgram = (options: CliOptions) => {
  const root = resolveRoot(options.root);
  return new Command('jeeves-scripts')
    .description('Run and manage jeeves-scripts jobs for this instance.')
    .enablePositionalOptions()
    .addCommand(buildConfigCommand(root))
    .addCommand(buildRunCommand(root))
    .addCommand(buildPeopleCommand())
    .addCommand(buildSlackCommand(root));
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
