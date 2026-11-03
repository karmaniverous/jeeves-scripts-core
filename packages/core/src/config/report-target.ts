/**
 * @module config/report-target
 *
 * Rules shared by the config blocks of runnables that write a dated
 * report and post a summary to Slack (`slack.channelMeta`,
 * `skillReview`): the report directory when a block sets no `outputDir`
 * ({@link defaultReportDir}: the report channel's `homeDir`) and the
 * gateway Slack accounts a block names ({@link unknownSlackAccounts}).
 * Each is written once for the config check (`config/schema`,
 * `config/check`) and the run's settings, so `config check`, `doctor`
 * and the run say the same thing (Decision 76). Pure apart from the
 * injected readers.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

/** Whether a report target is a channel (`C…`/`G…`), which may have a `homeDir`. */
export const isChannelTarget = (id: string): boolean => /^[CG]/.test(id);

/**
 * The report directory when `outputDir` is unset: the report channel's
 * `homeDir`. A DM target (a `D` id, a user, or no target at all) has
 * none, and neither may a channel; either way `outputDir` is required.
 *
 * @param target - The report target, `undefined` for an owner's DM.
 * @param homeDirOf - A channel's configured `homeDir`.
 * @param block - The block's config path, for messages (default
 *   `slack.channelMeta`).
 * @returns The directory, or why `outputDir` is required.
 */
export function defaultReportDir(
  target: string | undefined,
  homeDirOf: (channelId: string) => string | undefined,
  block = 'slack.channelMeta',
): { homeDir: string } | { problem: string } {
  if (target === undefined || !isChannelTarget(target))
    return {
      problem: `${block}.outputDir is required: the report goes to a DM, which has no homeDir`,
    };
  const homeDir = homeDirOf(target);
  return homeDir === undefined
    ? {
        problem: `${block}.outputDir is required: the report channel ${target} has no slack.channels.${target}.homeDir`,
      }
    : { homeDir };
}

/** A block key and the gateway Slack account it names. */
export type NamedAccount = [key: string, account: string];

/**
 * The accounts a block names that are not gateway Slack accounts. The
 * accounts are read only when the block names one.
 *
 * @param block - The block's config path, for messages.
 * @param named - The keys and the accounts they name.
 * @param accounts - The gateway Slack accounts (live: OpenClaw's
 *   configured bot tokens, `slackBotTokens`).
 * @returns The problem, or `undefined`.
 */
export function unknownSlackAccounts(
  block: string,
  named: readonly NamedAccount[],
  accounts: () => readonly string[],
): string | undefined {
  if (named.length === 0) return undefined;
  let known: readonly string[];
  try {
    known = accounts();
  } catch (e) {
    return `${block} names Slack accounts, but the gateway's could not be read: ${getErrorMessage(e)}`;
  }
  const unknown = named.filter(([, a]) => !known.includes(a));
  if (unknown.length === 0) return undefined;
  const which = unknown
    .map(([key, a]) => `${block}.${key}: "${a}" is not a gateway Slack account`)
    .join('; ');
  return `${which} (gateway Slack accounts: ${known.join(', ') || 'none'})`;
}
