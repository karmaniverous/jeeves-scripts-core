/**
 * @module slack/channel-meta/text-scope
 *
 * Which workspaces' channels the report may name with their generated
 * text. Generated descriptions and topics (proposed, set or current)
 * stay in their own workspace: the report shows them, and names the
 * channels they belong to, only for channels in the same gateway Slack
 * account as the report target (the workspace whose bot posts the
 * summary, `channel-meta/post`). Channels in any other workspace are counted per
 * workspace instead. `slack.channelMeta.reportTextAccounts` replaces that
 * default with an explicit list of accounts. Pure.
 */

import { code } from './report-md.js';

/**
 * The accounts whose channels' text the report may show.
 *
 * @param configured - `slack.channelMeta.reportTextAccounts`, if set.
 * @param reportAccount - The report target's account, if known.
 * @returns The configured list when set, else the target's account
 *   alone (none when it is unknown).
 */
export const textAccountsFor = (
  configured: readonly string[] | undefined,
  reportAccount: string | undefined,
): ReadonlySet<string> =>
  new Set(configured ?? (reportAccount === undefined ? [] : [reportAccount]));

/** One report bullet about a channel, with the channel's account. */
export interface ScopedLine {
  /** The channel's gateway account. */
  account: string;
  /** The bullet (names the channel, may quote its text). */
  line: string;
}

/**
 * The bullets the report may carry: each shown account's bullet as is,
 * then one count per other account, in first-seen order (e.g. "17
 * channel(s) in `vc` (text not shown outside that workspace)").
 *
 * @param items - Every bullet, with its channel's account.
 * @param shown - Accounts whose channels may be named.
 * @returns The bullets.
 */
export function scopedLines(
  items: readonly ScopedLine[],
  shown: ReadonlySet<string>,
): string[] {
  const lines: string[] = [];
  const hidden = new Map<string, number>();
  for (const { account, line } of items)
    if (shown.has(account)) lines.push(line);
    else hidden.set(account, (hidden.get(account) ?? 0) + 1);
  return [
    ...lines,
    ...[...hidden].map(
      ([account, n]) =>
        `${String(n)} channel(s) in ${code(account)} (text not shown outside that workspace)`,
    ),
  ];
}
