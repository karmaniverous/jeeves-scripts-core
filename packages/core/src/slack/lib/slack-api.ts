/**
 * @module slack/lib/slack-api
 *
 * The poller's Slack reads over core's one Slack client (lib/slack-client):
 * paginated conversation history, thread replies, channel discovery,
 * members and users, each with the token of the account reading. Includes
 * the pause between pages. No dependency on project constants or config.
 */

import { sleepAsync } from '@karmaniverous/jeeves';

import { createSlackClient } from '../../lib/slack-client.js';

/** Pause between Slack API calls, shared with slack/poll. */
export const RATE_LIMIT_MS = 1200;

/** The shared async sleep (`@karmaniverous/jeeves`). */
export const sleep = sleepAsync;

/**
 * Call a Slack Web API read method with `token` (the client's `call`: GET
 * with query parameters, a 429 retried after its `Retry-After`).
 *
 * @throws SlackApiError when the response is not JSON or `ok` is false
 * (`Slack <method> failed: <error>`).
 */
export function slackApi(
  method: string,
  params: Record<string, string>,
  token: string,
): Promise<Record<string, unknown>> {
  return createSlackClient({ token }).call(method, params);
}

/** Structured metadata for a Slack file attachment. */
export interface SlackFileMetadata {
  /** Slack file ID (e.g. "F0ABC123"). */
  id: string;
  /** Filename. */
  name: string;
  /** Slack's type classification ("png", "canvas", "text", "post", "pdf"). */
  filetype: string;
  /** MIME type. */
  mimetype: string;
  /** File size in bytes. */
  size?: number;
  /** Transcript text for audio files with Slack-provided transcription. */
  transcript?: string;
  /** Markdown/text content for text-extractable attachments. */
  markdown?: string;
  /** Why a text-extractable attachment's content was not inlined (e.g. over the size cap). */
  markdownSkipped?: string;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
  files?: SlackFileMetadata[];
  reactions?: { name: string; count: number }[];
}

export interface HistoryResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

/** Messages per `conversations.history` page. */
export const HISTORY_PAGE_SIZE = 200;

/**
 * One page of a channel's history: the (up to {@link HISTORY_PAGE_SIZE})
 * messages just after `oldest`, sorted oldest first, and whether newer ones
 * remain. Given `oldest` and no `latest`, Slack returns the messages
 * nearest `oldest` (newest first within the page), so the next page is the
 * same call with `oldest` moved to this page's newest message: a caller can
 * stop between pages and resume from its saved read position.
 */
export async function fetchHistoryPage(
  channelId: string,
  oldest: string,
  token: string,
): Promise<{ messages: SlackMessage[]; hasMore: boolean }> {
  const resp = (await slackApi(
    'conversations.history',
    { channel: channelId, limit: String(HISTORY_PAGE_SIZE), oldest },
    token,
  )) as HistoryResponse;
  const messages = (resp.messages ?? [])
    .filter((m) => m.ts > oldest)
    .sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0));
  return { messages, hasMore: resp.has_more === true };
}

export async function fetchReplies(
  channelId: string,
  threadTs: string,
  oldest: string,
  token: string,
): Promise<SlackMessage[]> {
  const replies: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string> = {
      channel: channelId,
      ts: threadTs,
      limit: '200',
    };
    if (cursor) params.cursor = cursor;
    await sleep(RATE_LIMIT_MS);

    const resp = (await slackApi(
      'conversations.replies',
      params,
      token,
    )) as HistoryResponse;
    const msgs = (resp.messages ?? []).filter((r) => r.ts !== threadTs);

    for (const reply of msgs) {
      if (reply.ts <= oldest) continue;
      replies.push(reply);
    }

    cursor = resp.response_metadata?.next_cursor;
  } while (cursor);

  return replies;
}

export interface SlackChannel {
  id: string;
  name?: string;
  user?: string;
  is_member?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  is_ext_shared?: boolean;
  shared_team_ids?: string[];
}

export async function discoverChannels(token: string): Promise<SlackChannel[]> {
  const allChannels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      types: 'public_channel,private_channel,im,mpim',
      limit: '200',
      exclude_archived: 'true',
    };
    if (cursor) params.cursor = cursor;

    const resp = (await slackApi('conversations.list', params, token)) as {
      channels?: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    };
    allChannels.push(...(resp.channels ?? []));
    cursor = resp.response_metadata?.next_cursor;
    if (cursor) await sleep(RATE_LIMIT_MS);
  } while (cursor);

  return allChannels;
}

/** Follow `response_metadata.next_cursor` through every page of `method`. */
async function allPages<T>(
  method: string,
  params: Record<string, string>,
  token: string,
  items: (resp: Record<string, unknown>) => T[] | undefined,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await slackApi(
      method,
      cursor ? { ...params, cursor } : params,
      token,
    );
    all.push(...(items(page) ?? []));
    cursor = (page.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (cursor) await sleep(RATE_LIMIT_MS);
  } while (cursor);
  return all;
}

/** A channel's member user ids (`conversations.members`). */
export function fetchMembers(
  channelId: string,
  token: string,
): Promise<string[]> {
  return allPages(
    'conversations.members',
    { channel: channelId, limit: '200' },
    token,
    (r) => r.members as string[] | undefined,
  );
}

/** A user as `users.list` returns it (the fields the cache keeps). */
export interface SlackApiUser {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; display_name?: string; email?: string };
}

/** Every user of the token's workspace (`users.list`). */
export function fetchUsers(token: string): Promise<SlackApiUser[]> {
  return allPages(
    'users.list',
    { limit: '200' },
    token,
    (r) => r.members as SlackApiUser[] | undefined,
  );
}
