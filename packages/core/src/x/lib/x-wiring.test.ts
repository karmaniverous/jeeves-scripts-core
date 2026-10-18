/**
 * Tests for the X edges not covered elsewhere: every timeline reader for a
 * known and an unknown handle, the live collaborators' config reads, and
 * the queue-action job declaration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { xQueueAction } from './run-x-queue-action.js';
import type { XTimelineClient, XTimelinePage } from './x-client.js';
import { xConfig, xJobDeps } from './x-deps.js';
import {
  pollBookmarks,
  pollHomeTimeline,
  pollLikedTweets,
  pollUserMentions,
  pollUserTweets,
} from './x-timelines.js';

const page: XTimelinePage = {
  data: [{ id: '1', text: 'hi', createdAt: '2026-01-01', authorId: 'a' }],
};
const client = (known: boolean): XTimelineClient => ({
  users: {
    getByUsername: (h: string) =>
      Promise.resolve({ data: known ? { id: `id-${h}` } : undefined }),
    getPosts: vi.fn(() => Promise.resolve(page)),
    getMentions: vi.fn(() => Promise.resolve(page)),
    getTimeline: vi.fn(() => Promise.resolve(page)),
    getLikedPosts: vi.fn(() => Promise.resolve(page)),
    getBookmarks: vi.fn(() => Promise.resolve({})),
  },
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('timeline readers', () => {
  it.each([
    ['posts', pollUserTweets],
    ['mentions', pollUserMentions],
    ['home', pollHomeTimeline],
    ['likes', pollLikedTweets],
  ] as const)(
    '%s: normalises the page for a known handle, nothing for an unknown one',
    async (_name, poll) => {
      const tweets = await poll(client(true), `wiring-${_name}`, {
        maxResults: 5,
        sinceId: '0',
      });
      expect(tweets.map((t) => t.id)).toEqual(['1']);
      await expect(poll(client(false), `ghost-${_name}`)).resolves.toEqual([]);
    },
  );

  it('bookmarks: an empty page is no tweets', async () => {
    await expect(pollBookmarks(client(true), 'wiring-bm')).resolves.toEqual([]);
    await expect(pollBookmarks(client(false), 'ghost-bm')).resolves.toEqual([]);
  });
});

describe('xJobDeps and xConfig', () => {
  it('read the accounts and the OAuth directory, and act through the credential files', async () => {
    expect(xConfig.accounts()).toEqual({});
    expect(xConfig.oauthDir()).toBe(xJobDeps().oauthDir);
    const live = xJobDeps();
    await expect(
      live.withClient('nobody', () => Promise.resolve(1)),
    ).rejects.toThrow('No X credentials for @nobody');
    await expect(live.refresh('nobody')).resolves.toBeNull();
  });
});

describe('xQueueAction', () => {
  it('declares the handle prerequisite and a run that hands back its work', () => {
    const job = xQueueAction({
      scriptName: 'x/like',
      queuePrefix: 'x-like',
      actionLabel: 'like',
      successLabel: 'liked',
      actionFn: () => Promise.resolve(true),
    });
    expect(
      job.prerequisite({
        args: [],
        flags: { maxItems: '50', queue: undefined },
      }),
    ).toMatch(/^No X account handle provided/);
    expect(typeof job.run).toBe('function');
  });
});
