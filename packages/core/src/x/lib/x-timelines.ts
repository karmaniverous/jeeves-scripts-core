/**
 * @module x/lib/x-timelines
 *
 * Read X timelines for a handle with an authenticated client: own posts,
 * mentions, home timeline, likes and bookmarks, normalised to `XTweet`
 * with the standard tweet fields.
 */

import type { Client } from '@xdevplatform/xdk';

import { lookupUser } from './x-api.js';

// ── Tweet type ─────────────────────────────────────────────────────

export interface XTweet {
  id: string;
  createdAt: string;
  text: string;
  authorId?: string;
}

// ── Standard tweet fields for all poll calls ───────────────────────

const TWEET_FIELDS = ['id', 'text', 'created_at', 'author_id'];

interface TweetLike {
  id?: string;
  text?: string;
  created_at?: string;
  author_id?: string;
}

function normaliseTweets(data: TweetLike[] | undefined): XTweet[] {
  if (!data) return [];
  return data
    .filter((t): t is TweetLike & { id: string } => !!t.id)
    .map((t) => ({
      id: t.id,
      createdAt: t.created_at ?? '',
      text: t.text ?? '',
      authorId: t.author_id,
    }));
}

// ── Poll helpers ───────────────────────────────────────────────────

export interface PollOptions {
  maxResults?: number;
  sinceId?: string;
}

/** A user-timeline read: the user id and request options in, a page out. */
type TimelineRead = (
  client: Client,
  userId: string,
  request: { maxResults: number; sinceId?: string; tweetFields: string[] },
) => Promise<{ data?: TweetLike[] }>;

/**
 * Build a poller over one user-timeline read: resolve the handle, read up
 * to `maxResults` (default 50) items, normalise them. `withSinceId` passes
 * `options.sinceId` through (the likes and bookmarks reads take none).
 */
const pollUserTimeline =
  (read: TimelineRead, withSinceId: boolean) =>
  async (
    client: Client,
    handle: string,
    options?: PollOptions,
  ): Promise<XTweet[]> => {
    const userId = await lookupUser(client, handle);
    if (!userId) return [];
    const res = await read(client, userId, {
      maxResults: options?.maxResults ?? 50,
      ...(withSinceId ? { sinceId: options?.sinceId } : {}),
      tweetFields: TWEET_FIELDS,
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
