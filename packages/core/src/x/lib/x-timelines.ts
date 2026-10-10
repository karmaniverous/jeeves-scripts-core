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

/** Fetch recent tweets authored by a handle. */
export async function pollUserTweets(
  client: Client,
  handle: string,
  options?: PollOptions,
): Promise<XTweet[]> {
  const userId = await lookupUser(client, handle);
  if (!userId) return [];

  const res = await client.users.getPosts(userId, {
    maxResults: options?.maxResults ?? 50,
    sinceId: options?.sinceId,
    tweetFields: TWEET_FIELDS,
  });
  return normaliseTweets(res.data);
}

/** Fetch recent mentions of a handle. */
export async function pollUserMentions(
  client: Client,
  handle: string,
  options?: PollOptions,
): Promise<XTweet[]> {
  const userId = await lookupUser(client, handle);
  if (!userId) return [];

  const res = await client.users.getMentions(userId, {
    maxResults: options?.maxResults ?? 50,
    sinceId: options?.sinceId,
    tweetFields: TWEET_FIELDS,
  });
  return normaliseTweets(res.data);
}

/** Fetch the home timeline for a handle. */
export async function pollHomeTimeline(
  client: Client,
  handle: string,
  options?: PollOptions,
): Promise<XTweet[]> {
  const userId = await lookupUser(client, handle);
  if (!userId) return [];

  const res = await client.users.getTimeline(userId, {
    maxResults: options?.maxResults ?? 50,
    sinceId: options?.sinceId,
    tweetFields: TWEET_FIELDS,
  });
  return normaliseTweets(res.data);
}

/** Fetch tweets liked by a handle. */
export async function pollLikedTweets(
  client: Client,
  handle: string,
  options?: PollOptions,
): Promise<XTweet[]> {
  const userId = await lookupUser(client, handle);
  if (!userId) return [];

  const res = await client.users.getLikedPosts(userId, {
    maxResults: options?.maxResults ?? 50,
    tweetFields: TWEET_FIELDS,
  });
  return normaliseTweets(res.data);
}

/** Fetch bookmarked tweets for a handle. */
export async function pollBookmarks(
  client: Client,
  handle: string,
  options?: PollOptions,
): Promise<XTweet[]> {
  const userId = await lookupUser(client, handle);
  if (!userId) return [];

  const res = await client.users.getBookmarks(userId, {
    maxResults: options?.maxResults ?? 50,
    tweetFields: TWEET_FIELDS,
  });
  return normaliseTweets(res.data);
}
