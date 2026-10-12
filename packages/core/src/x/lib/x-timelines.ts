/**
 * @module x/lib/x-timelines
 *
 * Read X timelines for a handle with an authenticated client: own posts,
 * mentions, home timeline, likes and bookmarks, normalised to `XTweet`
 * with the standard tweet fields.
 */

import { lookupUser } from './x-api.js';
import type {
  XTimelineClient,
  XTimelinePage,
  XTimelineRequest,
  XTweetData,
} from './x-client.js';

// ── Tweet type ─────────────────────────────────────────────────────

export interface XTweet {
  id: string;
  createdAt: string;
  text: string;
  authorId?: string;
}

// ── Standard tweet fields for all poll calls ───────────────────────

// `postFields` is the SDK's name for `tweet.fields`; the author id comes
// with the `author_id` expansion (not in the SDK's post field list).
const POST_FIELDS: XTimelineRequest['postFields'] = [
  'id',
  'text',
  'created_at',
];
const EXPANSIONS: XTimelineRequest['expansions'] = ['author_id'];

function normaliseTweets(data: XTweetData[] | undefined): XTweet[] {
  if (!data) return [];
  return data
    .filter((t): t is XTweetData & { id: string } => !!t.id)
    .map((t) => ({
      id: t.id,
      createdAt: t.createdAt ?? '',
      text: t.text ?? '',
      authorId: t.authorId,
    }));
}

// ── Poll helpers ───────────────────────────────────────────────────

export interface PollOptions {
  maxResults?: number;
  sinceId?: string;
}

/** A user-timeline read: the user id and request options in, a page out. */
type TimelineRead = (
  client: XTimelineClient,
  userId: string,
  request: XTimelineRequest,
) => Promise<XTimelinePage>;

/**
 * Build a poller over one user-timeline read: resolve the handle, read up
 * to `maxResults` (default 50) items, normalise them. `withSinceId` passes
 * `options.sinceId` through (the likes and bookmarks reads take none).
 */
const pollUserTimeline =
  (read: TimelineRead, withSinceId: boolean) =>
  async (
    client: XTimelineClient,
    handle: string,
    options?: PollOptions,
  ): Promise<XTweet[]> => {
    const userId = await lookupUser(client, handle);
    if (!userId) return [];
    const res = await read(client, userId, {
      maxResults: options?.maxResults ?? 50,
      ...(withSinceId ? { sinceId: options?.sinceId } : {}),
      postFields: POST_FIELDS,
      expansions: EXPANSIONS,
    });
    return normaliseTweets(res.data);
  };

/** Fetch recent tweets authored by a handle. */
export const pollUserTweets = pollUserTimeline(
  (c, id, r) => c.users.getPosts(id, r),
  true,
);

/** Fetch recent mentions of a handle. */
export const pollUserMentions = pollUserTimeline(
  (c, id, r) => c.users.getMentions(id, r),
  true,
);

/** Fetch the home timeline for a handle. */
export const pollHomeTimeline = pollUserTimeline(
  (c, id, r) => c.users.getTimeline(id, r),
  true,
);

/** Fetch tweets liked by a handle. */
export const pollLikedTweets = pollUserTimeline(
  (c, id, r) => c.users.getLikedPosts(id, r),
  false,
);

/** Fetch bookmarked tweets for a handle. */
export const pollBookmarks = pollUserTimeline(
  (c, id, r) => c.users.getBookmarks(id, r),
  false,
);
