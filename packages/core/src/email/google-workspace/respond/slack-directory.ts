/**
 * @module respond/slack-directory
 *
 * The real {@link SlackDirectory} for the email-respond Slack mirror,
 * over the Slack Web API with the gateway's bot token. Needs the bot
 * scopes `users:read.email` (lookup by email), `channels:read` /
 * `groups:read` (channel resolution and membership). Uses the
 * gateway's `default` Slack account token (slack/lib/channel-token.ts). A missing
 * `users:read.email` scope makes every lookup return null, so the mirror
 * posts nothing until the scope is granted.
 */

import { isRecord } from '../../../lib/is-record.js';
import { getTokens } from '../../../slack/lib/channel-token.js';
import { slackApi } from '../../../slack/lib/slack-api.js';
import type { ResolvedChannel, SlackDirectory } from './slack-mirror.js';

/** Slack API call shape ({@link slackApi} or a test double). */
export type SlackApiCall = (
  method: string,
  params: Record<string, string>,
) => Promise<Record<string, unknown>>;

/** Slack errors that mean "no such user" or "not allowed to look up". */
const LOOKUP_MISS = /users_not_found|missing_scope|not_allowed/;

const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/i;

/**
 * Walk a cursor-paginated Slack list method until `found` matches an
 * item of `listKey`.
 *
 * @returns The first matching item, or undefined after the last page.
 */
async function findInPages(
  call: SlackApiCall,
  method: string,
  params: Record<string, string>,
  listKey: string,
  found: (item: unknown) => boolean,
): Promise<unknown> {
  let cursor = '';
  do {
    const resp = await call(method, {
      ...params,
      limit: '200',
      ...(cursor ? { cursor } : {}),
    });
    const items: unknown = resp[listKey];
    const hit: unknown = Array.isArray(items)
      ? (items as unknown[]).find(found)
      : undefined;
    if (hit !== undefined) return hit;
    const meta = resp.response_metadata;
    cursor =
      isRecord(meta) && typeof meta.next_cursor === 'string'
        ? meta.next_cursor
        : '';
  } while (cursor);
  return undefined;
}

function toChannel(c: unknown): ResolvedChannel | null {
  if (!isRecord(c) || typeof c.id !== 'string') return null;
  return { id: c.id, isMember: c.is_member === true };
}

/** Build the directory over a Slack API caller. */
export function slackDirectory(call: SlackApiCall): SlackDirectory {
  return {
    lookupUserByEmail: async (email) => {
      try {
        const resp = await call('users.lookupByEmail', { email });
        const user = resp.user;
        return isRecord(user) && typeof user.id === 'string' ? user.id : null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (LOOKUP_MISS.test(msg)) return null;
        throw err;
      }
    },
    resolveChannel: async (nameOrId) => {
      const wanted = nameOrId.trim().replace(/^#/, '');
      // A name like `general` also looks like an id; when the id lookup
      // finds nothing, fall through to name resolution.
      if (CHANNEL_ID.test(wanted)) {
        try {
          const resp = await call('conversations.info', {
            channel: wanted.toUpperCase(),
          });
          const byId = toChannel(resp.channel);
          if (byId) return byId;
        } catch {
          // not an id (or not readable as one): try it as a name
        }
      }
      const name = wanted.toLowerCase();
      const hit = await findInPages(
        call,
        'conversations.list',
        { types: 'public_channel,private_channel', exclude_archived: 'true' },
        'channels',
        (c) => isRecord(c) && c.name === name,
      );
      return toChannel(hit);
    },
    isChannelMember: async (channelId, userId) =>
      (await findInPages(
        call,
        'conversations.members',
        { channel: channelId },
        'members',
        (m) => m === userId,
      )) !== undefined,
  };
}

/** The directory over the live Slack API, or null without a token. */
export function liveSlackDirectory(): SlackDirectory | null {
  const token = getTokens().default;
  if (!token) return null;
  return slackDirectory((method, params) => slackApi(method, params, token));
}
