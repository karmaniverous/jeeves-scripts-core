/**
 * @module people/people-propose
 *
 * The runnable `people-propose [--all] [--out <file>]` (Decisions 34, 49):
 * reads the Slack users of every gateway bot account (read-only), prints a
 * proposed `people` block as JSON on stdout and, with `--out`, writes the
 * same JSON (UTF-8) to a file. It never writes `jeeves-scripts.json`: an
 * `--out` naming it fails before Slack is read. Run with
 * `jeeves-scripts run people-propose`; it has no manifest.
 */

import fs from 'node:fs';
import path from 'node:path';

import { argFlag, argOptional, type ParsedArgs } from '../lib/args.js';
import { defineRunnable } from '../runnables/define-runnable.js';
import { proposeFromSlack } from './propose.js';

/** Collaborators of {@link peoplePropose}, injectable for tests. */
export interface PeopleProposeDeps {
  /** Builds the proposal (default: {@link proposeFromSlack}). */
  propose: typeof proposeFromSlack;
  /** Writes stdout. */
  write: (text: string) => void;
}

const defaultDeps: PeopleProposeDeps = {
  propose: proposeFromSlack,
  write: (text) => process.stdout.write(text),
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
 * @throws When `--out` names `jeeves-scripts.json` (any case).
 */
export async function peoplePropose(
  flags: Partial<ParsedArgs<typeof peopleProposeFlags>>,
  deps: PeopleProposeDeps = defaultDeps,
): Promise<void> {
  const values = flags;
  // Case-insensitive: on Windows JEEVES-SCRIPTS.JSON is the same file.
  if (
    values.out &&
    path.basename(values.out).toLowerCase() === 'jeeves-scripts.json'
  )
    throw new Error('people-propose never writes jeeves-scripts.json');
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
