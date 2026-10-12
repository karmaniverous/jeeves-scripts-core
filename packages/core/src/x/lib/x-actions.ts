/**
 * @module x/lib/x-actions
 *
 * Write actions on X for an authenticated client: post, like/unlike and
 * repost/unrepost. Called from the queue-driven X jobs.
 */

import { lookupUser } from './x-api.js';
import type { XPostBody, XPostsApi, XUserActionsClient } from './x-client.js';

// ── Write actions ──────────────────────────────────────────────────

/** Create a tweet, reply, or quote tweet. */
export async function createPost(
  client: { posts: XPostsApi },
  text: string,
  options?: { inReplyToTweetId?: string; quoteTweetId?: string },
): Promise<{ id?: string }> {
  const body: XPostBody = { text };
  if (options?.inReplyToTweetId)
    body.reply = { inReplyToTweetId: options.inReplyToTweetId };
  if (options?.quoteTweetId) body.quoteTweetId = options.quoteTweetId;

  const res = await client.posts.create(body);
  return {
    id: res.data?.id,
  };
}

/** Like a tweet on behalf of a handle. */
export async function likePost(
  client: XUserActionsClient,
  handle: string,
  tweetId: string,
): Promise<boolean> {
  const userId = await lookupUser(client, handle);
  if (!userId) return false;

  await client.users.likePost(userId, { tweetId });
  return true;
}

/** Remove a like from a tweet on behalf of a handle. */
export async function unlikePost(
  client: XUserActionsClient,
  handle: string,
  tweetId: string,
): Promise<boolean> {
  const userId = await lookupUser(client, handle);
  if (!userId) return false;

  await client.users.unlikePost(userId, tweetId);
  return true;
}

/** Repost (retweet) a tweet on behalf of a handle. */
export async function repostPost(
  client: XUserActionsClient,
  handle: string,
  tweetId: string,
): Promise<boolean> {
  const userId = await lookupUser(client, handle);
  if (!userId) return false;

  await client.users.repostPost(userId, { tweetId });
  return true;
}

/** Remove a repost on behalf of a handle. */
export async function unrepostPost(
  client: XUserActionsClient,
  handle: string,
  tweetId: string,
): Promise<boolean> {
  const userId = await lookupUser(client, handle);
  if (!userId) return false;

  await client.users.unrepostPost(userId, tweetId);
  return true;
}
