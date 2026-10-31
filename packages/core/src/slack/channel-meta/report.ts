/**
 * @module slack/channel-meta/report
 *
 * The report file (Markdown, {@link reportMarkdown}), written to
 * `<outputDir>/<YYYY-MM-DD>.md`: workspaces (with missing scopes), the
 * home-directory sweep (the exact `config set` command for each proposed
 * home directory, quoted for POSIX shells and PowerShell,
 * `channel-meta/proposal-command`, Decision 66; mismatches, assigned paths missing on disk), coverage (no home
 * directory, home directory missing, no seeded meta), what happened to
 * descriptions and topics and why (`channel-meta/report-fields`: the generated
 * text of each value set or already current, and in a dry run each
 * proposed value beside the current one, named and quoted only for
 * channels in the report target's own workspace, `channel-meta/text-scope`; other
 * workspaces' channels are counted there), and which channels couldn't
 * be read or swept in full (history cut at its page cap, a post whose
 * path couldn't be read). The workspace, sweep and coverage sections name
 * every channel (name and id) and path; the generated texts appear only
 * as so scoped; a channel's raw messages never do. Errors are already
 * report-safe when they get here: Slack's method and code, or a fixed
 * unexpected-error line (`channel-meta/report-safe`), and a worker problem in
 * fixed wording (`channel-meta/worker-batch`). The Slack summary that links to it
 * is `channel-meta/summary`. Pure.
 */

import { homeDirMissing, noHomeDir, unseeded } from './coverage.js';
import type { ChannelFacts } from './gather.js';
import { proposalLines } from './proposal-command.js';
import { fieldSection } from './report-fields.js';
import { FIELDS, type ReportInput } from './report-input.js';
import { code, label, list, mdText } from './report-md.js';
import { missingScopes, type Workspace } from './workspaces.js';

const workspaceLine = (ws: Workspace): string => {
  const name = ws.team ? ` (${mdText(ws.team)})` : '';
  if (ws.error !== undefined)
    return `- ${code(ws.account)}${name}: not read: ${code(ws.error)}`;
  const missing = missingScopes(ws.scopes);
  const scopes =
    ws.scopes === undefined
      ? ', scopes unknown'
      : missing.length > 0
        ? `, missing scopes ${missing.map(code).join(', ')}`
        : '';
  return `- ${code(ws.account)}${name}: ${String(ws.channels.length)} member channel(s)${scopes}`;
};

const proposalsOf = (facts: readonly ChannelFacts[]) =>
  facts.flatMap((f) =>
    f.finding?.kind === 'proposal'
      ? [{ id: f.channel.id, path: f.finding.path }]
      : [],
  );

const sweepSection = (facts: readonly ChannelFacts[]): string[] => {
  const proposals = proposalsOf(facts);
  const lines = ['## Home-directory sweep'];
  if (proposals.length > 0) lines.push(...proposalLines(proposals));
  lines.push(
    ...list(
      'Assignments that differ from the config',
      facts.flatMap((f) =>
        f.finding?.kind === 'mismatch'
          ? [
              `${label(f)}: posted ${code(f.finding.path)}${f.finding.exists ? '' : ' (missing on disk)'}, configured ${code(f.finding.configured)}`,
            ]
          : [],
      ),
    ),
    ...list(
      'Assigned directories missing on disk',
      facts.flatMap((f) =>
        f.finding?.kind === 'missing-dir'
          ? [`${label(f)}: ${code(f.finding.path)}`]
          : [],
      ),
    ),
  );
  return lines.length === 1 ? [...lines, '', 'No new assignments.'] : lines;
};

const coverageSection = (facts: readonly ChannelFacts[]): string[] => {
  const lines = [
    '## Coverage',
    ...list('No home directory', facts.filter(noHomeDir).map(label)),
    ...list(
      'Home directory missing on disk',
      facts
        .filter(homeDirMissing)
        .map((f) => `${label(f)}: ${code(f.homeDir ?? '')}`),
    ),
    ...list(
      'No seeded meta (`.meta/meta.json`)',
      facts
        .filter(unseeded)
        .map((f) => `${label(f)}: ${code(f.homeDir ?? '')}`),
    ),
  ];
  return lines.length === 1
    ? [
        ...lines,
        '',
        'Every member channel has a home directory with a seeded meta.',
      ]
    : lines;
};

/**
 * The report file's body without its heading (what a quiet day compares).
 *
 * @param input - The report's inputs.
 * @returns Markdown.
 */
export function reportBody(input: ReportInput): string {
  const byId = new Map(input.facts.map((f) => [f.channel.id, f]));
  const sections = [
    ['## Workspaces', '', ...input.workspaces.map(workspaceLine)],
    sweepSection(input.facts),
    coverageSection(input.facts),
    ...FIELDS.map((field) => fieldSection(field, input, byId)),
  ];
  if (input.workerProblem !== undefined)
    sections.push([
      '## Worker',
      '',
      `No values set: ${mdText(input.workerProblem)}`,
    ]);
  const unreadable = input.facts.flatMap((f) =>
    f.readError === undefined ? [] : [`${label(f)}: ${code(f.readError)}`],
  );
  const incomplete = input.facts.flatMap((f) =>
    (f.sweepNotes ?? []).map((n) => `${label(f)}: ${mdText(n)}`),
  );
  if (unreadable.length + incomplete.length > 0)
    sections.push([
      '## Messages unreadable',
      ...list('No archive, and history refused', unreadable),
      ...list('Sweep incomplete', incomplete),
    ]);
  return sections.map((s) => s.join('\n')).join('\n\n');
}

/**
 * The whole report file.
 *
 * @param input - The report's inputs.
 * @param body - {@link reportBody} for the same input.
 * @returns Markdown.
 */
export function reportMarkdown(input: ReportInput, body: string): string {
  return `# Slack channel descriptions, topics and home directories (${input.date})\n\n${body}\n`;
}
