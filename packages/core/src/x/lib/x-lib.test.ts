/**
 * Tests for the modules split out of x-api: credential files and token
 * refresh (x-oauth), timeline reads (x-timelines) and write actions
 * (x-actions), with a fake XDK client and OAuth2.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Client } from '@xdevplatform/xdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dir: '',
  refreshToken: vi.fn(),
  oauthOptions: [] as unknown[],
}));

vi.mock('../../lib/constants.js', () => ({
  constants: () => ({ X_OAUTH_DIR: mocks.dir }),
}));
vi.mock('@xdevplatform/xdk', () => ({
  OAuth2: class {
    constructor(options: unknown) {
      mocks.oauthOptions.push(options);
    }
    refreshToken = mocks.refreshToken;
  },
}));

const {
  getOAuthPath,
  readOAuthCredentials,
  refreshOAuth2Token,
  writeOAuthCredentials,
} = await import('./x-oauth.js');
const { pollBookmarks, pollHomeTimeline, pollUserTweets } =
  await import('./x-timelines.js');
const { createPost, likePost, repostPost, unlikePost, unrepostPost } =
  await import('./x-actions.js');

beforeEach(() => {
  mocks.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-lib-'));
});

afterEach(() => {
  fs.rmSync(mocks.dir, { recursive: true, force: true });
  mocks.oauthOptions.length = 0;
  vi.clearAllMocks();
});

describe('x-oauth', () => {
  it('stores credentials at {X_OAUTH_DIR}/x-<handle>-oauth2.json', () => {
    expect(getOAuthPath('karma')).toBe(
      path.join(mocks.dir, 'x-karma-oauth2.json'),
    );
    expect(readOAuthCredentials('karma')).toBeNull();
    writeOAuthCredentials('karma', {
      provider: 'x',
      account: 'karma',
      access_token: 'a',
    });
    expect(readOAuthCredentials('karma')).toEqual({
      provider: 'x',
      account: 'karma',
      access_token: 'a',
    });
  });

  it('reads an unparseable file as no credentials', () => {
    fs.writeFileSync(getOAuthPath('karma'), '{');
    expect(readOAuthCredentials('karma')).toBeNull();
  });

  it('skips refresh without a refresh token or client credentials', async () => {
    expect(await refreshOAuth2Token('nobody')).toBeNull();
    writeOAuthCredentials('karma', {
      provider: 'x',
      account: 'karma',
      access_token: 'a',
      clientId: 'id',
    });
    expect(await refreshOAuth2Token('karma')).toBeNull();
    expect(mocks.refreshToken).not.toHaveBeenCalled();
  });

  it('refreshes and writes the new tokens back, keeping the old refresh token if none is returned', async () => {
    writeOAuthCredentials('karma', {
      provider: 'x',
      account: 'karma',
      access_token: 'old',
      refresh_token: 'rt',
      clientId: 'id',
      clientSecret: 'secret',
    });
    mocks.refreshToken.mockResolvedValue({
      access_token: 'new',
      token_type: 'bearer',
      scope: 'tweet.read',
      expires_in: 7200,
    });
    await expect(refreshOAuth2Token('karma')).resolves.toEqual({
      accessToken: 'new',
      refreshToken: 'rt',
      tokenType: 'bearer',
      scope: 'tweet.read',
      expiresIn: 7200,
    });
    expect(mocks.oauthOptions).toEqual([
      {
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'https://localhost',
      },
    ]);
    expect(mocks.refreshToken).toHaveBeenCalledWith('rt');
    expect(readOAuthCredentials('karma')).toMatchObject({
      access_token: 'new',
      refresh_token: 'rt',
      clientSecret: 'secret',
      expires_in: 7200,
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
    expect(users.likePost).not.toHaveBeenCalled();
  });
});
