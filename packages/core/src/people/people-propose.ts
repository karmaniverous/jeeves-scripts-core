/**
 * @module people/people-propose
 *
 * The runnable `people-propose [--all] [--out <file>]` (Decisions 34, 49):
 * reads the Slack users of every gateway bot account (read-only), prints a
 * proposed `people` block as JSON on stdout and, with `--out`, writes the
 * same JSON (UTF-8) to a file. It never writes the instance config: an
 * `--out` naming `jeeves-scripts.json` or the config file it resolves to
 * (#57) fails before Slack is read. Run with
 * `jeeves-scripts run people-propose`; it has no manifest.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getLoadedConfigPath, resolveConfigPath } from '../config/loader.js';
import { argFlag, argOptional, type ParsedArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { proposeFromSlack } from './propose.js';

/** Collaborators of {@link peoplePropose}, injectable for tests. */
export interface PeopleProposeDeps {
  /** Builds the proposal (default: {@link proposeFromSlack}). */
  propose: typeof proposeFromSlack;
  /** Writes stdout. */
  write: (text: string) => void;
  /** The instance config file, when it can be resolved. */
  configFile: () => string | undefined;
}

/** The loaded config file, else the one the loader would resolve. */
const currentConfigFile = (): string | undefined => {
  try {
    return getLoadedConfigPath() ?? resolveConfigPath();
  } catch {
    return undefined;
  }
};

const defaultDeps: PeopleProposeDeps = {
  propose: proposeFromSlack,
  write: (text) => process.stdout.write(text),
  configFile: currentConfigFile,
};

/** The flags `people-propose` accepts. */
export const peopleProposeFlags = {
  all: argFlag('--all', 'Include every Slack user, not only likely people'),
  out: argOptional('--out', {
    description: 'Also write the proposal to this file',
  }),
};

/**
 * Run `people-propose` with its parsed flags.
 *
 * @throws When `--out` names `jeeves-scripts.json` or the instance config
 *   file (any case).
 */
export async function peoplePropose(
  flags: Partial<ParsedArgs<typeof peopleProposeFlags>>,
  deps: PeopleProposeDeps = defaultDeps,
): Promise<void> {
  const values = flags;
  // Case-insensitive: on Windows JEEVES-SCRIPTS.JSON is the same file.
  const config = deps.configFile();
  if (
    values.out &&
    (path.basename(values.out).toLowerCase() === 'jeeves-scripts.json' ||
      (config !== undefined &&
        path.resolve(values.out).toLowerCase() ===
          path.resolve(config).toLowerCase()))
  )
    throw new Error(
      'people-propose never writes the instance config (jeeves-scripts.json or its config file)',
    );
  const proposal = await deps.propose({ all: values.all });
  const json = `${JSON.stringify(proposal, null, 2)}\n`;
  if (values.out) fs.writeFileSync(values.out, json, 'utf8');
  deps.write(json);
}

export default defineRunnable({
  id: 'people-propose',
  domain: 'people',
  description:
    'Propose a people block from the Slack users of every gateway bot account (read-only; never writes config).',
  flags: peopleProposeFlags,
  run: ({ flags }) => peoplePropose(flags),
});
