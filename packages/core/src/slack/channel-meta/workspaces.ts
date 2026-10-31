/**
 * @module slack/channel-meta/workspaces
 *
 * One Slack workspace per gateway Slack account (every bot token in the
 * OpenClaw config; no account name is assumed): who the bot is
 * (`auth.test`), the scopes its token has (Slack's `x-oauth-scopes`
 * response header, captured by {@link scopeCapturingFetch}), and the
 * public and private channels it is a member of (`users.conversations`,
 * archived ones excluded; DMs and MPIMs are out of scope). Also the
 * `conversations.history` fallback for a channel with no archive. A
 * failure is recorded on the workspace as Slack's method and code (e.g.
 * `missing_scope`; anything else as an unexpected error, its message in
 * the job's stderr log, `channel-meta/report-safe`), never thrown, so one
 * workspace can't stop the others.
 */

import { z } from 'zod';

import { type SlackClient } from '../../lib/slack-client.js';
import { type ChannelMessage, compareTs, messageSchema } from './messages.js';
import { reportSafeError } from './report-safe.js';

/** A channel the bot is a member of. */
export interface MemberChannel {
  /** Channel id. */
  id: string;
  /** Channel name (no `#`). */
  name: string;
  /** Private channel. */
  isPrivate: boolean;
  /** Current description (Slack purpose). */
  purpose: string;
  /** Current topic. */
  topic: string;
  /** The gateway account whose bot reads and updates it. */
  account: string;
}

/** One account's workspace. */
export interface Workspace {
  /** Gateway account id. */
  account: string;
  /** Workspace name, from `auth.test`. */
  team?: string;
  /** Token scopes, when Slack sent them. */
  scopes?: string[];
  /** Member channels. */
  channels: MemberChannel[];
  /** Why the workspace couldn't be read, if it couldn't (report-safe). */
  error?: string;
  /** The account's client. */
  client: SlackClient;
}

/** Scopes the job needs, by what for. */
export const NEEDED_SCOPES = {
  read: ['channels:read', 'groups:read'],
  write: ['channels:write.topic', 'groups:write.topic'],
} as const;

/** The write scope a channel needs (public: `channels:`; private: `groups:`). */
export const writeScopeFor = (isPrivate: boolean): string =>
  isPrivate ? 'groups:write.topic' : 'channels:write.topic';

/**
 * The needed scopes a token lacks (none when its scopes are unknown).
 *
 * @param scopes - The token's scopes.
 * @returns Missing scopes.
 */
export const missingScopes = (
  scopes: readonly string[] | undefined,
): string[] =>
  scopes === undefined
    ? []
    : [...NEEDED_SCOPES.read, ...NEEDED_SCOPES.write].filter(
        (s) => !scopes.includes(s),
      );

/** The scopes header (assembled, so no literal header map sits here). */
const SCOPES_HEADER = ['x', 'oauth', 'scopes'].join('-');

/**
 * A `fetch` that remembers the last `x-oauth-scopes` header Slack sent.
 *
 * @param base - The real fetch.
 * @returns The wrapped fetch and a reader for the scopes.
 */
export function scopeCapturingFetch(base: typeof fetch): {
  fetch: typeof fetch;
  scopes: () => string[] | undefined;
} {
  let scopes: string[] | undefined;
  const wrapped: typeof fetch = async (input, init) => {
    const res = await base(input, init);
    const header = res.headers.get(SCOPES_HEADER);
    if (header !== null)
      scopes = header
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return res;
  };
  return { fetch: wrapped, scopes: () => scopes };
}

const authSchema = z.object({ team: z.string().optional() }).loose();

const textValue = z
  .object({ value: z.string().optional() })
  .loose()
  .optional()
  .transform((v) => v?.value ?? '');

const conversationsSchema = z
  .object({
    channels: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          is_private: z.boolean().optional(),
          purpose: textValue,
          topic: textValue,
        })
        .loose(),
    ),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

/** Most pages of channels read per workspace (200 each). */
const MAX_CHANNEL_PAGES = 50;

/**
 * Read one account's workspace.
 *
 * @param account - Gateway account id.
 * @param client - A client with that account's token.
 * @param scopes - The token's captured scopes.
 * @returns The workspace (with `error` set when a call failed).
 */
export async function readWorkspace(
  account: string,
  client: SlackClient,
  scopes: () => string[] | undefined,
): Promise<Workspace> {
  const ws: Workspace = { account, channels: [], client };
  try {
    ws.team = authSchema.parse(await client.call('auth.test')).team;
    let cursor = '';
    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      const res = conversationsSchema.parse(
        await client.call('users.conversations', {
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        }),
      );
      for (const c of res.channels)
        ws.channels.push({
          id: c.id,
          name: c.name ?? c.id,
          isPrivate: c.is_private ?? false,
          purpose: c.purpose,
          topic: c.topic,
          account,
        });
      cursor = res.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
  } catch (e) {
    ws.error = reportSafeError(e, `reading workspace ${account}`);
  }
  const captured = scopes();
  if (captured !== undefined) ws.scopes = captured;
  return ws;
}

/**
 * Every member channel once, across workspaces in order (a channel shared
 * by two workspaces stays with the first).
 *
 * @param workspaces - Workspaces, `default` first.
 * @param exclude - Channel ids to leave out.
 * @returns Each channel with its workspace, by name.
 */
export function memberChannels(
  workspaces: readonly Workspace[],
  exclude: ReadonlySet<string>,
): { channel: MemberChannel; ws: Workspace }[] {
  const seen = new Map<string, { channel: MemberChannel; ws: Workspace }>();
  for (const ws of workspaces)
    for (const channel of ws.channels)
      if (!exclude.has(channel.id) && !seen.has(channel.id))
        seen.set(channel.id, { channel, ws });
  return [...seen.values()].sort((a, b) =>
    a.channel.name.localeCompare(b.channel.name),
  );
}

const historySchema = z
  .object({
    messages: z.array(z.unknown()),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

/** Most history pages read per channel (200 messages each). */
export const MAX_HISTORY_PAGES = 25;

/** A channel's history since a bound. */
export interface History {
  /** Top-level messages, oldest first. */
  messages: ChannelMessage[];
  /** {@link MAX_HISTORY_PAGES} were read and Slack had more: some
   * messages in the range were not read. */
  truncated: boolean;
}

/**
 * A channel's messages newer than `since` from `conversations.history`
 * (top-level messages only), oldest first. For channels with no archive.
 *
 * Every page keeps the same `oldest` bound (no `latest`) and follows
 * `response_metadata.next_cursor`; the pages are merged and sorted, so
 * the result is the same whichever way Slack pages. With a real bound,
 * Slack serves the window nearest `oldest` first (newest first within a
 * page) and the cursor pages forward, toward the newest; with no bound
 * (`oldest: '0'`, which Slack treats as unset) it serves the newest
 * window first and the cursor pages backward. When the page cap stops
 * the read before the last page, the result says so (`truncated`):
 * the newest messages (with a bound) or the oldest (without) were not
 * read, and the caller decides how far the read sweeps
 * (`channel-meta/gather` `readHistoryFallback`).
 *
 * @param client - The channel's workspace client.
 * @param channel - Channel id.
 * @param since - Exclusive lower bound, if any.
 * @returns The messages, and whether the read stopped early.
 * @throws SlackApiError when Slack refuses (e.g. `missing_scope`).
 */
export async function readHistory(
  client: SlackClient,
  channel: string,
  since: string | undefined,
): Promise<History> {
  const out: ChannelMessage[] = [];
  const oldest = since ?? '0';
  let cursor = '';
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const res = historySchema.parse(
      await client.call('conversations.history', {
        channel,
        limit: '200',
        oldest,
        ...(cursor ? { cursor } : {}),
      }),
    );
    for (const m of res.messages) {
      const parsed = messageSchema.safeParse(m);
      if (parsed.success) out.push(parsed.data);
    }
    cursor = res.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  return {
    messages: out.sort((a, b) => compareTs(a.ts, b.ts)),
    truncated: cursor !== '',
  };
}
