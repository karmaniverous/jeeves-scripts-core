/**
 * End-to-end test of the Slack poller over a temp archive (`useTempConfig`)
 * and a scripted Slack Web API (`fetch`): workspace lookup, discovery,
 * history, thread replies, message files and read positions.
 */

import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeFetch } from '../lib/fake-fetch.test-helper.js';
import { fakeRunnerClient } from '../lib/fake-runner-client.test-helper.js';
import { useTempConfig } from '../lib/temp-config.test-helper.js';
import { pollSlack, type SlackPollDeps, slackPollDeps } from './poll.js';

vi.mock('@karmaniverous/jeeves', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sleepAsync: () => Promise.resolve(),
}));

const baseDir = useTempConfig();
let runner: ReturnType<typeof fakeRunnerClient>;

const api: Record<string, (q: URLSearchParams) => unknown> = {
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
};

const deps = (over: Partial<SlackPollDeps> = {}): SlackPollDeps => ({
  slackDir: path.join(baseDir(), 'content', 'slack'),
  tokens: () => ({ default: 'xoxb-test' }),
  runner: () => runner.client,
  ...over,
});

const files = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
    : [];

beforeEach(() => {
  runner = fakeRunnerClient();
  const fake = fakeFetch((call) => {
    const method = call.url.pathname.replace('/api/', '');
    const handler = api[method];
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

describe('pollSlack', () => {
  it('skips when the Slack directory does not exist', async () => {
    await pollSlack(deps());
    expect(console.log).toHaveBeenCalledWith(
      '[skip] Slack domain directory not configured',
    );
    expect(runner.closed()).toBe(false);
  });

  it('writes new messages and replies, saves read positions and carries on past a failing channel', async () => {
    fs.mkdirSync(deps().slackDir, { recursive: true });
    await pollSlack(deps());
    const written = files(deps().slackDir);
    expect(
      written.filter((f) => f.endsWith('.json')).length,
    ).toBeGreaterThanOrEqual(3);
    expect(console.error).toHaveBeenCalledWith(
      'ERROR C2: Slack API conversations.history: not_in_channel',
    );
    expect(console.log).toHaveBeenCalledWith('Total: 3 new messages');
    expect([...runner.state.values()]).toContain('100.5');
    expect(runner.closed()).toBe(true);

    vi.mocked(console.log).mockClear();
    await pollSlack(deps());
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Total:/),
    );
  });
});

describe('slackPollDeps', () => {
  it('reads the Slack directory from config', () => {
    expect(slackPollDeps().slackDir).toBe(
      path.join(baseDir(), 'content', 'slack'),
    );
  });
});
