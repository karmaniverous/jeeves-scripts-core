/**
 * @module slack/channel-meta/post
 *
 * Where the summary goes and which workspace's bot posts it
 * ({@link findDestination}), found before the report is written, since
 * the report shows generated text only for that workspace's channels
 * (`channel-meta/text-scope`). With `slack.channelMeta.reportAccount` set, that
 * account's bot posts. Else the job finds it: for a user (the OpenClaw
 * owner by default) the first workspace, `default` first, whose bot can
 * open a DM with them (a user belongs to the workspace whose bot can
 * reach them; opening a DM sends nothing); for a DM conversation id
 * (`D…`, which the member-channel listing never holds) the first
 * workspace whose bot can see it (`conversations.info`, read-only); for
 * a channel, the first workspace the bot is a member of it in.
 * {@link postSummary} then posts there and nowhere else.
 */

import { getErrorMessage } from '@karmaniverous/jeeves';

import { SlackApiError } from '../../lib/slack-client.js';
import { isDmTarget, isUserTarget } from './settings.js';
import type { Workspace } from './workspaces.js';

/** The summary's destination. */
export interface Destination {
  /** The workspace whose bot posts. */
  ws: Workspace;
  /** The conversation id (a channel, or the user's DM). */
  channel: string;
}

const codeOf = (e: unknown): string =>
  e instanceof SlackApiError ? e.code : getErrorMessage(e);

/** The workspaces to try, in order. */
const candidates = (
  target: string,
  account: string | undefined,
  workspaces: readonly Workspace[],
): Workspace[] => {
  if (account !== undefined) {
    const ws = workspaces.find((w) => w.account === account);
    if (ws === undefined)
      throw new Error(
        `slack.channelMeta.reportAccount "${account}" is not a gateway Slack account`,
      );
    return [ws];
  }
  if (isUserTarget(target) || isDmTarget(target)) return [...workspaces];
  return workspaces.filter((w) => w.channels.some((c) => c.id === target));
};

/**
 * The conversation a candidate bot reaches the target in; throws when it
 * can't. A user's DM is opened; a DM id is looked up, unless the account
 * is configured (then it is taken as is, like a channel).
 */
const reach = async (
  ws: Workspace,
  target: string,
  configured: boolean,
): Promise<string> => {
  if (isUserTarget(target)) return ws.client.openDm(target);
  if (isDmTarget(target) && !configured)
    await ws.client.call('conversations.info', { channel: target });
  return target;
};

/**
 * Find the summary's destination.
 *
 * @param target - Channel id, DM id, or user id (their DM).
 * @param account - The configured posting account, if any.
 * @param workspaces - Every workspace, `default` first.
 * @returns The posting workspace and conversation.
 * @throws Error when no bot can reach the target, with each workspace's
 *   refusal (for a channel: no workspace has the bot as a member).
 */
export async function findDestination(
  target: string,
  account: string | undefined,
  workspaces: readonly Workspace[],
): Promise<Destination> {
  const refusals: string[] = [];
  for (const ws of candidates(target, account, workspaces))
    try {
      return { ws, channel: await reach(ws, target, account !== undefined) };
    } catch (e) {
      refusals.push(`${ws.account}: ${codeOf(e)}`);
    }
  const why =
    isUserTarget(target) || isDmTarget(target)
      ? refusals.join('; ') || 'no Slack accounts'
      : 'the bot is not a member of it in any workspace; invite it or set slack.channelMeta.reportAccount';
  throw new Error(`no Slack bot can reach ${target} (${why})`);
}

/**
 * Post the summary to its destination.
 *
 * @param text - Slack mrkdwn.
 * @param destination - From {@link findDestination}.
 * @returns The account whose bot posted.
 * @throws Error naming the account and Slack's refusal.
 */
export async function postSummary(
  text: string,
  destination: Destination,
): Promise<string> {
  const { ws, channel } = destination;
  try {
    await ws.client.postMessage(channel, text);
  } catch (e) {
    throw new Error(
      `the ${ws.account} bot could not post the summary to ${channel}: ${codeOf(e)}`,
      { cause: e },
    );
  }
  return ws.account;
}
