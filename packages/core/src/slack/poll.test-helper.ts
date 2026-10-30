/**
 * @module slack/poll.test-helper
 *
 * Shared fixture for the Slack poller suites: a temp archive
 * (`useTempConfig`), a fake runner state store and a scripted Slack Web
 * API (`fetch`) whose handlers a test may replace. Test support only.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, vi } from 'vitest';

import { fakeFetch } from '../lib/fake-fetch.test-helper.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import type { SlackPollDeps } from './poll.js';

/** A scripted Slack Web API method. */
type Handler = (q: URLSearchParams) => unknown;

/** Two channels: C1 has two messages and a thread; C2 can't be read. */
const defaultApi = (): Record<string, Handler> => ({
  'auth.test': () => ({ ok: true, team_id: 'T1' }),
  'conversations.list': () => ({
    ok: true,
    channels: [
      { id: 'C1', name: 'general', is_member: true },
      { id: 'C2', name: 'broken', is_member: true },
    ],
  }),
  'users.list': () => ({
    ok: true,
    members: [{ id: 'U1', name: 'jane', real_name: 'Jane Doe' }],
  }),
  'conversations.members': () => ({ ok: true, members: ['U1'] }),
  'conversations.info': (q) => ({
    ok: true,
    channel: { id: q.get('channel'), context_team_id: 'T1' },
  }),
  'conversations.history': (q) =>
    q.get('channel') === 'C2'
      ? { ok: false, error: 'not_in_channel' }
      : {
          ok: true,
          messages: [
            { ts: '100.1', user: 'U1', text: 'hello', reply_count: 1 },
            { ts: '100.2', user: 'U1', text: 'second' },
          ],
        },
  'conversations.replies': () => ({
    ok: true,
    messages: [
      { ts: '100.1' },
      { ts: '100.5', user: 'U1', text: 'reply', thread_ts: '100.1' },
    ],
  }),
});

/**
 * A `conversations.history` handler for C1 holding `n` top-level messages
 * (ts `200.000001` up), ordered as Slack orders them with no `latest`
 * (#50): for a real `oldest`, the `limit` messages just after it, newest
 * first, `has_more` when newer ones remain; for `oldest` unset or 0, the
 * channel's newest `limit` messages, `has_more` when older ones remain.
 * Other channels are empty; `onFetch` runs on each C1 page.
 */
export const c1History =
  (
    n: number,
    extra: Record<string, unknown> = {},
    onFetch?: () => void,
  ): Handler =>
  (q) => {
    if (q.get('channel') !== 'C1') return { ok: true, messages: [] };
    onFetch?.();
    const oldest = Number(q.get('oldest') ?? 0);
    const after = Array.from({ length: n }, (_, i) => ({
      ts: `${String(200 + i)}.000001`,
      user: 'U1',
      text: `m${String(i)}`,
      ...extra,
    })).filter((m) => Number(m.ts) > oldest);
    const limit = Number(q.get('limit'));
    const page = oldest > 0 ? after.slice(0, limit) : after.slice(-limit);
    return {
      ok: true,
      messages: page.reverse(),
      has_more: after.length > limit,
    };
  };

/**
 * Register the fixture's hooks; returns accessors valid inside tests. The
 * API handlers reset before each test.
 */
export const usePollFixture = () => {
  const baseDir = useTempConfig();
  const api: Record<string, Handler> = {};
  let runner: ReturnType<typeof fakeRunnerClient>;
  let fake: ReturnType<typeof fakeFetch>;

  beforeEach(() => {
    for (const key of Object.keys(api)) Reflect.deleteProperty(api, key);
    Object.assign(api, defaultApi());
    runner = fakeRunnerClient();
    fake = fakeFetch((call) => {
      const handler = api[call.url.pathname.replace('/api/', '')];
      return { body: handler ? handler(call.url.searchParams) : { ok: true } };
    });
    vi.stubGlobal('fetch', fake.fetch);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const deps = (over: Partial<SlackPollDeps> = {}): SlackPollDeps => ({
    slackDir: path.join(baseDir(), 'content', 'slack'),
    tokens: () => ({ default: 'xoxb-test' }),
    runner: () => runner.client,
    config: () => ({ backfillBudgetSeconds: 60 }),
    now: () => 0,
    ...over,
  });

  return {
    api,
    baseDir,
    deps,
    runner: () => runner,
    fake: () => fake,
    /** Recorded `conversations.history` request URLs. */
    histories: () =>
      fake.calls
        .map((c) => c.url)
        .filter((u) => u.pathname === '/api/conversations.history'),
    /** File names under `dir`, recursively (none when it is missing). */
    files: (dir: string): string[] =>
      fs.existsSync(dir)
        ? fs
            .readdirSync(dir, { recursive: true, withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => e.name)
        : [],
  };
};
