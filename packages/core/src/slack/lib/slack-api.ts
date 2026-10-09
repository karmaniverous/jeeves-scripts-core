/**
 * @module slack/lib/slack-api
 *
 * Typed wrappers over the Slack Web API REST endpoints.
 *
 * Pure HTTP helpers consumed by slack/poll. Provides paginated fetching
 * for conversation history, thread replies, and channel discovery.
 * Includes a rate-limit sleep utility. No dependency on project
 * constants or config.
 */

import https from 'node:https';

const RATE_LIMIT_MS = 1200;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function slackApi(
  method: string,
  params: Record<string, string>,
  token: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const opts = {
      hostname: 'slack.com',
      path: `/api/${method}?${qs}`,
      headers: { Authorization: `Bearer ${token}` },
    };
    https
      .get(opts, (res) => {
        let d = '';
        res.on('data', (c: Buffer) => (d += c.toString()));
        res.on('end', () => {
          try {
            const j = JSON.parse(d) as Record<string, unknown>;
            if (!j.ok) {
              reject(new Error(`Slack API ${method}: ${j.error as string}`));
            } else {
              resolve(j);
            }
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      })
      .on('error', reject);
  });
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
  reactions?: Array<{ name: string; count: number }>;
}

export interface HistoryResponse {
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

export async function fetchHistory(
  channelId: string,
  oldest: string,
  token: string,
): Promise<{ messages: SlackMessage[]; newestTs: string }> {
  let cursor: string | undefined;
  const allMessages: SlackMessage[] = [];
  let newestTs = oldest;

  do {
    const params: Record<string, string> = {
      channel: channelId,
      limit: '200',
      oldest,
    };
    if (cursor) params.cursor = cursor;

    const resp = (await slackApi(
      'conversations.history',
      params,
      token,
    )) as HistoryResponse;
    const messages = resp.messages ?? [];

    for (const msg of messages) {
      if (msg.ts <= oldest) continue;
      allMessages.push(msg);
      if (msg.ts > newestTs) newestTs = msg.ts;
    }

    cursor = resp.has_more ? resp.response_metadata?.next_cursor : undefined;
    if (cursor) await sleep(RATE_LIMIT_MS);
  } while (cursor);

  return { messages: allMessages, newestTs };
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
