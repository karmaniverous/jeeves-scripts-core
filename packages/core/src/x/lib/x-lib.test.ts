/**
 * Tests for the modules split out of x-api: credential files and token
 * refresh (x-oauth, with an injected refresher), timeline reads
 * (x-timelines) and write actions (x-actions), with a fake XDK client.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Client } from '@xdevplatform/xdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPost,
  likePost,
  repostPost,
  unlikePost,
  unrepostPost,
} from './x-actions.js';
import {
  getOAuthPath,
  readOAuthCredentials,
  refreshOAuth2Token,
  writeOAuthCredentials,
} from './x-oauth.js';
import {
  pollBookmarks,
  pollHomeTimeline,
  pollUserTweets,
} from './x-timelines.js';

let dir: string;
const refresher = vi.fn();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-lib-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('x-oauth', () => {
  it('stores credentials at {oauthDir}/x-<handle>-oauth2.json', () => {
    expect(getOAuthPath(dir, 'karma')).toBe(
      path.join(dir, 'x-karma-oauth2.json'),
    );
    expect(readOAuthCredentials(dir, 'karma')).toBeNull();
    writeOAuthCredentials(dir, 'karma', {
      provider: 'x',
      account: 'karma',
      access_token: 'a',
    });
    expect(readOAuthCredentials(dir, 'karma')).toEqual({
      provider: 'x',
      account: 'karma',
      access_token: 'a',
    });
  });

  it('reads an unparseable file as no credentials', () => {
    fs.writeFileSync(getOAuthPath(dir, 'karma'), '{');
    expect(readOAuthCredentials(dir, 'karma')).toBeNull();
  });

  it('skips refresh without a refresh token or client credentials', async () => {
    expect(await refreshOAuth2Token(dir, 'nobody', refresher)).toBeNull();
    writeOAuthCredentials(dir, 'karma', {
      provider: 'x',
      account: 'karma',
      access_token: 'a',
      clientId: 'id',
    });
    expect(await refreshOAuth2Token(dir, 'karma', refresher)).toBeNull();
    expect(refresher).not.toHaveBeenCalled();
  });

  it('refreshes and writes the new tokens back, keeping the old refresh token if none is returned', async () => {
    writeOAuthCredentials(dir, 'karma', {
      provider: 'x',
      account: 'karma',
      access_token: 'old',
      refresh_token: 'rt',
      clientId: 'id',
      clientSecret: 'secret',
    });
    refresher.mockResolvedValue({
      access_token: 'new',
      token_type: 'bearer',
      scope: 'tweet.read',
      expires_in: 7200,
    });
    const at = new Date('2026-01-01T00:00:00Z');
    await expect(
      refreshOAuth2Token(dir, 'karma', refresher, () => at),
    ).resolves.toEqual({
      accessToken: 'new',
      refreshToken: 'rt',
      tokenType: 'bearer',
      scope: 'tweet.read',
      expiresIn: 7200,
    });
    expect(refresher).toHaveBeenCalledWith(
      { clientId: 'id', clientSecret: 'secret' },
      'rt',
    );
    expect(readOAuthCredentials(dir, 'karma')).toMatchObject({
      access_token: 'new',
      refresh_token: 'rt',
      clientSecret: 'secret',
      expires_in: 7200,
      obtained_at: at.toISOString(),
    });
  });
});

/** A fake client recording calls; user lookup resolves `handle` to `id-<handle>`. */
const fakeClient = (data: unknown[] = []) => {
  const page = { data };
  const users = {
    getByUsername: vi.fn((handle: string) =>
      Promise.resolve({
        data: handle === 'ghost' ? undefined : { id: `id-${handle}` },
      }),
    ),
    getPosts: vi.fn(() => Promise.resolve(page)),
    getMentions: vi.fn(() => Promise.resolve(page)),
    getTimeline: vi.fn(() => Promise.resolve(page)),
    getLikedPosts: vi.fn(() => Promise.resolve(page)),
    getBookmarks: vi.fn(() => Promise.resolve(page)),
    likePost: vi.fn(() => Promise.resolve({})),
    unlikePost: vi.fn(() => Promise.resolve({})),
    repostPost: vi.fn(() => Promise.resolve({})),
    unrepostPost: vi.fn(() => Promise.resolve({})),
  };
  const posts = {
    create: vi.fn(() => Promise.resolve({ data: { id: 'p1' } })),
  };
  return { client: { users, posts } as unknown as Client, users, posts };
};

describe('x-timelines', () => {
  it('normalises tweets, dropping those without an id', async () => {
    const { client, users } = fakeClient([
      { id: '1', text: 't', created_at: '2026-10-01', author_id: 'a' },
      { text: 'no id' },
      { id: '2' },
    ]);
    await expect(
      pollUserTweets(client, 'karma', { maxResults: 5, sinceId: '0' }),
    ).resolves.toEqual([
      { id: '1', text: 't', createdAt: '2026-10-01', authorId: 'a' },
      { id: '2', text: '', createdAt: '', authorId: undefined },
    ]);
    expect(users.getPosts).toHaveBeenCalledWith('id-karma', {
      maxResults: 5,
      sinceId: '0',
      tweetFields: ['id', 'text', 'created_at', 'author_id'],
    });
  });

  it('returns nothing for a handle that does not resolve', async () => {
    const { client, users } = fakeClient([{ id: '1' }]);
    await expect(pollHomeTimeline(client, 'ghost')).resolves.toEqual([]);
    expect(users.getTimeline).not.toHaveBeenCalled();
  });

  it('reads bookmarks for the resolved user', async () => {
    const { client, users } = fakeClient([{ id: '9' }]);
    expect((await pollBookmarks(client, 'karma')).map((t) => t.id)).toEqual([
      '9',
    ]);
    expect(users.getBookmarks).toHaveBeenCalledWith(
      'id-karma',
      expect.anything(),
    );
  });
});

describe('x-actions', () => {
  it('creates a post with reply and quote fields', async () => {
    const { client, posts } = fakeClient();
    await expect(
      createPost(client, 'hello', { inReplyToTweetId: 'r', quoteTweetId: 'q' }),
    ).resolves.toEqual({ id: 'p1' });
    expect(posts.create).toHaveBeenCalledWith({
      text: 'hello',
      reply: { in_reply_to_tweet_id: 'r' },
      quote_tweet_id: 'q',
    });
  });

  it('likes, unlikes, reposts and unreposts as the resolved user', async () => {
    const { client, users } = fakeClient();
    expect(await likePost(client, 'karma', 't1')).toBe(true);
    expect(await unlikePost(client, 'karma', 't1')).toBe(true);
    expect(await repostPost(client, 'karma', 't1')).toBe(true);
    expect(await unrepostPost(client, 'karma', 't1')).toBe(true);
    expect(users.likePost).toHaveBeenCalledWith('id-karma', { tweetId: 't1' });
    expect(users.repostPost).toHaveBeenCalledWith('id-karma', {
      tweetId: 't1',
    });
  });

  it('does nothing for a handle that does not resolve', async () => {
    const { client, users } = fakeClient();
    expect(await likePost(client, 'ghost', 't1')).toBe(false);
    expect(await repostPost(client, 'ghost', 't1')).toBe(false);
    expect(users.likePost).not.toHaveBeenCalled();
    expect(users.repostPost).not.toHaveBeenCalled();
  });
});
