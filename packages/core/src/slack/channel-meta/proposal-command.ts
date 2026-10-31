/**
 * @module slack/channel-meta/proposal-command
 *
 * The exact command that applies a proposed home directory (Decision 66:
 * the runnable never writes the config; `config set` validates the edit
 * and is a dry run until `--live` is added). It is run from the instance
 * repo with the repo's launcher, `node bin/jeeves-scripts.js`, as the
 * guides run every command.
 *
 * The path is always single-quoted. Inside single quotes POSIX shells
 * and PowerShell both take every character literally (`&`, `;`, `|`,
 * `$`, back-tick, `*`, `!`, spaces), except the quote itself, which they
 * escape differently: POSIX closes the quote (`'\''`), PowerShell doubles
 * it (`''`, and treats the typographic single quotes `‘ ’ ‚ ‛` the same
 * way). So a path with none of those quote characters has one command
 * both shells read the same ({@link sharedQuoting}); a path with one gets
 * a command per shell ({@link homeDirCommand}). Pure.
 */

/** The instance repo's launcher, as the guides run it. */
export const LAUNCHER = 'node bin/jeeves-scripts.js';

/** A shell the report gives commands for. */
export type Shell = 'posix' | 'powershell';

/** Every character PowerShell reads as a single quote. */
const POWERSHELL_QUOTE = /['\u2018\u2019\u201A\u201B]/;

/**
 * Whether one single-quoted form of `value` reads the same in POSIX
 * shells and PowerShell: it has no character either reads as a single
 * quote.
 *
 * @param value - The argument.
 * @returns `true` when one command serves both shells.
 */
export const sharedQuoting = (value: string): boolean =>
  !POWERSHELL_QUOTE.test(value);

/**
 * `value` as one literal argument for a shell.
 *
 * @param value - The argument.
 * @param shell - The shell that reads it.
 * @returns `value` single-quoted, its single quotes escaped for `shell`.
 */
export const shellQuote = (value: string, shell: Shell): string =>
  shell === 'posix'
    ? `'${value.replaceAll("'", String.raw`'\''`)}'`
    : `'${value.replace(new RegExp(POWERSHELL_QUOTE.source, 'g'), (q) => q + q)}'`;

/**
 * The command that applies a proposed home directory.
 *
 * @param channelId - The channel.
 * @param dir - The proposed home directory.
 * @param shell - The shell it is written for (the same for both when
 *   {@link sharedQuoting} holds).
 * @returns The `config set` command line (a dry run).
 */
export const homeDirCommand = (
  channelId: string,
  dir: string,
  shell: Shell,
): string =>
  `${LAUNCHER} config set slack.channels.${channelId}.homeDir ${shellQuote(dir, shell)}`;

/** A proposed home directory. */
export interface Proposal {
  /** The channel. */
  id: string;
  /** The proposed directory. */
  path: string;
}

const block = (proposals: readonly Proposal[], shell: Shell): string[] => [
  '```',
  ...proposals.map((p) => homeDirCommand(p.id, p.path, shell)),
  '```',
];

/**
 * The report's lines for the proposals (non-empty): what to do, and one
 * command block for both shells, or one per shell when a path needs it.
 *
 * @param proposals - The proposals.
 * @returns Markdown lines.
 */
export function proposalLines(proposals: readonly Proposal[]): string[] {
  const intro = `Proposed home directories (${String(proposals.length)}); review each, run its command from the instance repo, then run it again with \`--live\` to write the config`;
  if (proposals.every((p) => sharedQuoting(p.path)))
    return [
      '',
      `${intro} (the same command in POSIX shells and PowerShell):`,
      '',
      ...block(proposals, 'posix'),
    ];
  return [
    '',
    `${intro}. A path holds a single quote, which POSIX shells and PowerShell escape differently: use the block for your shell.`,
    '',
    'POSIX shells (bash, zsh):',
    '',
    ...block(proposals, 'posix'),
    '',
    'PowerShell:',
    '',
    ...block(proposals, 'powershell'),
  ];
}
