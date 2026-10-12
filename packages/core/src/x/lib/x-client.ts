/**
 * @module x/lib/x-client
 *
 * The narrow X API client surface the X runnables call: user lookup, the
 * user-timeline reads, like/repost and post creation. The `@xdevplatform/xdk`
 * `Client` satisfies it (checked where `x-api` builds one); tests implement
 * it directly, so a fake missing a method fails to compile. Types only.
 */

/** A tweet as a timeline read returns it (the SDK camel-cases response keys). */
export interface XTweetData {
  id?: string;
  text?: string;
  createdAt?: string;
  authorId?: string;
}

/** A user-timeline read's request. */
export interface XTimelineRequest {
  maxResults: number;
  sinceId?: string;
  postFields: ('id' | 'text' | 'created_at')[];
  expansions: 'author_id'[];
}

/** A user-timeline read's page. */
export interface XTimelinePage {
  data?: XTweetData[];
}

/** A response carrying an optional object id (user lookup, post creation). */
export interface XIdResponse {
  data?: { id?: string };
}

/** A new post: text, optionally a reply or a quote (the SDK snake-cases the keys on the wire). */
export interface XPostBody {
  text: string;
  reply?: { inReplyToTweetId: string };
  quoteTweetId?: string;
}

/** The `users` calls the runnables make. */
export interface XUsersApi {
  getByUsername(username: string): Promise<XIdResponse>;
  getPosts(id: string, request: XTimelineRequest): Promise<XTimelinePage>;
  getMentions(id: string, request: XTimelineRequest): Promise<XTimelinePage>;
  getTimeline(id: string, request: XTimelineRequest): Promise<XTimelinePage>;
  getLikedPosts(id: string, request: XTimelineRequest): Promise<XTimelinePage>;
  getBookmarks(id: string, request: XTimelineRequest): Promise<XTimelinePage>;
  likePost(id: string, body: { tweetId: string }): Promise<unknown>;
  unlikePost(id: string, tweetId: string): Promise<unknown>;
  repostPost(id: string, body: { tweetId: string }): Promise<unknown>;
  unrepostPost(id: string, tweetId: string): Promise<unknown>;
}

/** The `posts` calls the runnables make. */
export interface XPostsApi {
  create(body: XPostBody): Promise<XIdResponse>;
}

/** Everything the runnables call on an authenticated client. */
export interface XClient {
  users: XUsersApi;
  posts: XPostsApi;
}

/** What a user lookup needs. */
export interface XUserLookupClient {
  users: Pick<XUsersApi, 'getByUsername'>;
}

/** What the timeline readers need. */
export interface XTimelineClient {
  users: Pick<
    XUsersApi,
    | 'getByUsername'
    | 'getPosts'
    | 'getMentions'
    | 'getTimeline'
    | 'getLikedPosts'
    | 'getBookmarks'
  >;
}

/** What the like and repost actions need. */
export interface XUserActionsClient {
  users: Pick<
    XUsersApi,
    'getByUsername' | 'likePost' | 'unlikePost' | 'repostPost' | 'unrepostPost'
  >;
}
