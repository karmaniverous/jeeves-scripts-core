/**
 * @module admin/lib/session-refresh-notice
 *
 * The one-line notice after a live reset of a Slack session (spec 2.12,
 * behaviour 9): posted in the session's own conversation (its channel or
 * DM) as the Slack account the session belongs to, through core's Slack
 * client. An OpenClaw app message on Slack does not start a turn, so the
 * notice costs nothing. Only a Slack-keyed session whose origin is Slack
 * gets one (owner, 2026-11-04): an agent's main session never does, even
 * when its last delivery went to Slack, since it serves many conversations.
 * Nothing is ever sent into the session itself.
 */

import type { SlackClient } from '../../lib/slack-client.js';
import type { SessionRow } from './session-refresh-gateway.js';
import { parseKey } from './session-refresh-select.js';

/** The notice text. */
export const NOTICE_TEXT =
  '\u{1f504} This session was reset to cut context cost. I will recover context from the channel history on the next message.';

/** Where a Slack session's notice goes. */
export interface SlackNoticeTarget {
  /** The gateway Slack account (`channels.slack.accounts.<id>`). */
  accountId: string;
  /** A conversation id (channel or DM) to post in. */
  channel?: string;
  /** A user whose DM to open when no conversation id is recorded. */
  user?: string;
  /** The thread, for a thread-scoped session. */
  threadTs?: string;
}

/**
 * Whether the row is a Slack session that gets the notice: its key is a
 * Slack key (`agent:<id>:slack:…`) and its origin is Slack. The delivery
 * context alone never qualifies a row (an agent's main session delivers
 * wherever it last spoke).
 */
export function isSlackSession(row: SessionRow): boolean {
  const slackKey = parseKey(row.key)?.rest.startsWith('slack:') ?? false;
  return slackKey && row.origin?.provider === 'slack';
}

/** `channel:<id>` / `user:<id>` from a delivery target. */
function fromTo(to: string | null | undefined): Partial<SlackNoticeTarget> {
  const m = /^(channel|user):([A-Za-z0-9]+)$/.exec(to ?? '');
  if (!m) return {};
  return m[1] === 'channel' ? { channel: m[2] } : { user: m[2] };
}

/** The conversation and thread named by the key itself. */
function fromKey(rest: string): Partial<SlackNoticeTarget> {
  const [, kind = '', id = '', thread = '', ts = ''] = rest.split(':');
  const threadTs = thread === 'thread' && ts ? ts : undefined;
  if (!id) return {};
  const target =
    kind === 'channel'
      ? { channel: id.toUpperCase() }
      : kind === 'direct'
        ? { user: id.toUpperCase() }
        : {};
  return { ...target, ...(threadTs ? { threadTs } : {}) };
}

/**
 * Where a Slack session's notice goes: the account from its delivery
 * context (else its origin, else its last delivery, else `default`); the
 * conversation from the (Slack) origin's `nativeChannelId`, else a Slack
 * delivery target, else the key; the thread from the key.
 *
 * @returns The target, or undefined when the row is not a Slack session.
 */
export function slackNoticeTarget(
  row: SessionRow,
): SlackNoticeTarget | undefined {
  if (!isSlackSession(row)) return undefined;
  const accountId =
    row.deliveryContext?.accountId ??
    row.origin?.accountId ??
    row.lastAccountId ??
    'default';
  const keyed = fromKey(parseKey(row.key)?.rest ?? '');
  const native = row.origin?.nativeChannelId;
  const dc = row.deliveryContext;
  const delivered = pick(fromTo(dc?.channel === 'slack' ? dc.to : undefined));
  const where = native
    ? { channel: native }
    : delivered.channel || delivered.user
      ? delivered
      : pick(keyed);
  return {
    accountId,
    ...where,
    ...(keyed.threadTs ? { threadTs: keyed.threadTs } : {}),
  };
}

/** The conversation part (channel, else user) of a partial target. */
function pick(t: Partial<SlackNoticeTarget>): Partial<SlackNoticeTarget> {
  if (t.channel) return { channel: t.channel };
  return t.user ? { user: t.user } : {};
}

/**
 * Post the notice for a reset session.
 *
 * @param row - The reset session's row.
 * @param slackFor - A Slack client for a gateway account (its bot token).
 * @returns `none` for a session with no Slack conversation, else `posted`.
 * @throws When the Slack session names no conversation or the post fails.
 */
export async function postResetNotice(
  row: SessionRow,
  slackFor: (accountId: string) => SlackClient,
): Promise<'posted' | 'none'> {
  const target = slackNoticeTarget(row);
  if (!target) return 'none';
  const { channel, user, threadTs, accountId } = target;
  if (!channel && !user)
    throw new Error(`no Slack conversation recorded for ${row.key}`);
  const slack = slackFor(accountId);
  const conversation = channel ?? (await slack.openDm(user ?? ''));
  await slack.postMessage(
    conversation,
    NOTICE_TEXT,
    threadTs ? { threadTs } : undefined,
  );
  return 'posted';
}
