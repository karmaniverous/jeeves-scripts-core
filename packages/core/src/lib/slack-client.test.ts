/**
 * Tests for the Slack Web API client over a scripted fetch: request shapes
 * (GET query, JSON POST, bearer token), `ok:false` and non-JSON errors,
 * 429 retries after `Retry-After`, messages, DMs, the three-step upload
 * (including a failed byte upload) and downloads.
 */

import { describe, expect, it, vi } from 'vitest';

import { createSlackClient, SlackApiError } from './slack-client.js';

/** A fetch answering each request with the next scripted response. */
const scripted = (...responses: unknown[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const r of responses)
    fetch.mockResolvedValueOnce(
      r instanceof Response ? r : new Response(JSON.stringify(r)),
    );
  return fetch;
};

const client = (
  fetch: typeof globalThis.fetch,
  sleep = vi.fn((ms: number) => Promise.resolve(ms).then(() => undefined)),
  rateLimitAttempts?: number,
) => ({
  sleep,
  slack: createSlackClient({
    token: 'xoxb-test',
    fetch,
    sleep,
    ...(rateLimitAttempts ? { rateLimitAttempts } : {}),
  }),
});

const AUTH = { Authorization: 'Bearer xoxb-test' };

describe('call', () => {
  it('GETs the method with its query and the bearer token', async () => {
    const fetch = scripted({ ok: true, team_id: 'T1' });
    await expect(
      client(fetch).slack.call('auth.test', { a: '1', b: 'x y' }),
    ).resolves.toEqual({ ok: true, team_id: 'T1' });
    expect(fetch).toHaveBeenCalledWith(
      'https://slack.com/api/auth.test?a=1&b=x+y',
      { headers: AUTH },
    );
  });

  it('omits the query string without parameters', async () => {
    const fetch = scripted({ ok: true });
    await client(fetch).slack.call('auth.test');
    expect(fetch.mock.calls[0]?.[0]).toBe('https://slack.com/api/auth.test');
  });

  it('throws a SlackApiError with the Slack error code', async () => {
    const fetch = scripted({ ok: false, error: 'channel_not_found' });
    const err = await client(fetch)
      .slack.call('conversations.info', { channel: 'C000EXAMPLE1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlackApiError);
    expect(err).toMatchObject({
      method: 'conversations.info',
      code: 'channel_not_found',
      message: 'Slack conversations.info failed: channel_not_found',
    });
  });

  it('says "unknown" when Slack is not ok without an error', async () => {
    await expect(
      client(scripted({ ok: false })).slack.call('auth.test'),
    ).rejects.toThrow('Slack auth.test failed: unknown');
  });

  it('reports the status of a body that is not JSON', async () => {
    const fetch = scripted(
      new Response('<html>bad gateway</html>', { status: 502 }),
    );
    await expect(client(fetch).slack.call('auth.test')).rejects.toMatchObject({
      code: 'invalid_response',
      message:
        'Slack auth.test failed: HTTP 502, body is not JSON: <html>bad gateway</html>',
    });
  });

  it('rejects JSON without an ok field', async () => {
    await expect(
      client(scripted({ hello: 1 })).slack.call('auth.test'),
    ).rejects.toThrow('Slack auth.test failed: no ok field');
  });

  it('uses the global fetch at call time when none is injected', async () => {
    const fetch = scripted({ ok: true });
    vi.stubGlobal('fetch', fetch);
    try {
      await createSlackClient({ token: 't' }).call('auth.test');
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('rate limits', () => {
  const limited = (retryAfter?: string) =>
    new Response('', {
      status: 429,
      headers: retryAfter ? { 'Retry-After': retryAfter } : {},
    });

  it('waits Retry-After seconds and retries a 429', async () => {
    const fetch = scripted(limited('7'), { ok: true, n: 1 });
    const { slack, sleep } = client(fetch);
    await expect(slack.call('users.list')).resolves.toEqual({ ok: true, n: 1 });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(7000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('waits one second when Retry-After is missing or invalid', async () => {
    const fetch = scripted(limited(), limited('soon'), { ok: true });
    const { slack, sleep } = client(fetch);
    await slack.post('chat.postMessage', { channel: 'C1', text: 'x' });
    expect(sleep.mock.calls).toEqual([[1000], [1000]]);
  });

  it('gives up with "ratelimited" after the configured attempts', async () => {
    const fetch = scripted(limited('1'), limited('1'));
    const { slack, sleep } = client(fetch, undefined, 2);
    await expect(slack.call('users.list')).rejects.toMatchObject({
      code: 'ratelimited',
      message: 'Slack users.list failed: ratelimited',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('does not retry a Slack error', async () => {
    const fetch = scripted({ ok: false, error: 'invalid_auth' });
    const { slack, sleep } = client(fetch);
    await expect(slack.call('auth.test')).rejects.toThrow('invalid_auth');
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('typed methods', () => {
  it('postMessage POSTs JSON and resolves channel and ts', async () => {
    const fetch = scripted({ ok: true, channel: 'C1', ts: '1.2' });
    await expect(
      client(fetch).slack.postMessage('C1', 'hi', { threadTs: '1.0' }),
    ).resolves.toEqual({ channel: 'C1', ts: '1.2' });
    expect(fetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json; charset=utf-8' },
        body: '{"channel":"C1","text":"hi","thread_ts":"1.0"}',
      },
    );
  });

  it('postMessage sends no thread_ts outside a thread', async () => {
    const fetch = scripted({ ok: true, channel: 'D1', ts: '1' });
    await client(fetch).slack.postMessage('D1', 'hi');
    expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"channel":"D1","text":"hi"}');
  });

  it('openDm opens the DM and resolves its channel id', async () => {
    const fetch = scripted({ ok: true, channel: { id: 'D42' } });
    await expect(client(fetch).slack.openDm('U1')).resolves.toBe('D42');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://slack.com/api/conversations.open',
    );
    expect(fetch.mock.calls[0]?.[1]?.body).toBe('{"users":"U1"}');
  });

  it('download GETs the URL with the token', async () => {
    const fetch = scripted(new Response('file text'));
    const res = await client(fetch).slack.download('https://files.slack/x');
    await expect(res.text()).resolves.toBe('file text');
    expect(fetch).toHaveBeenCalledWith('https://files.slack/x', {
      headers: AUTH,
    });
  });
});

describe('uploadFile', () => {
  const RESERVED = {
    ok: true,
    upload_url: 'https://files.slack/u/1',
    file_id: 'F1',
  };
  const bytes = new TextEncoder().encode('abc');

  it('reserves a URL, posts the bytes and completes the share', async () => {
    const fetch = scripted(RESERVED, new Response('OK - 3'), { ok: true });
    await expect(
      client(fetch).slack.uploadFile({
        bytes,
        filename: 'a.xlsx',
        channelId: 'D42',
        title: 'Title',
        initialComment: 'Here',
        contentType: 'application/x',
      }),
    ).resolves.toBe('F1');
    const calls = fetch.mock.calls;
    expect(calls[0]).toEqual([
      'https://slack.com/api/files.getUploadURLExternal?filename=a.xlsx&length=3',
      { headers: AUTH },
    ]);
    expect(calls[1]).toEqual([
      'https://files.slack/u/1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x' },
        body: bytes,
      },
    ]);
    expect(calls[2]?.[0]).toBe(
      'https://slack.com/api/files.completeUploadExternal',
    );
    expect(JSON.parse(calls[2]?.[1]?.body as string)).toEqual({
      files: [{ id: 'F1', title: 'Title' }],
      channel_id: 'D42',
      initial_comment: 'Here',
    });
  });

  it('defaults the title, content type and comment', async () => {
    const fetch = scripted(RESERVED, new Response('OK'), { ok: true });
    await client(fetch).slack.uploadFile({
      bytes,
      filename: 'a.bin',
      channelId: 'C1',
    });
    expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({
      'Content-Type': 'application/octet-stream',
    });
    expect(JSON.parse(fetch.mock.calls[2]?.[1]?.body as string)).toEqual({
      files: [{ id: 'F1', title: 'a.bin' }],
      channel_id: 'C1',
    });
  });

  it('stops when Slack refuses the upload URL', async () => {
    const fetch = scripted({ ok: false, error: 'not_authed' });
    await expect(
      client(fetch).slack.uploadFile({ bytes, filename: 'a', channelId: 'C1' }),
    ).rejects.toThrow('Slack files.getUploadURLExternal failed: not_authed');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('throws without completing the share when the byte upload fails', async () => {
    const fetch = scripted(RESERVED, new Response('nope', { status: 500 }));
    await expect(
      client(fetch).slack.uploadFile({
        bytes,
        filename: 'a.xlsx',
        channelId: 'C1',
      }),
    ).rejects.toThrow('Slack file upload failed: HTTP 500 for a.xlsx');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws when completing the share fails', async () => {
    const fetch = scripted(RESERVED, new Response('OK'), {
      ok: false,
      error: 'channel_not_found',
    });
    await expect(
      client(fetch).slack.uploadFile({ bytes, filename: 'a', channelId: 'C1' }),
    ).rejects.toThrow(
      'Slack files.completeUploadExternal failed: channel_not_found',
    );
  });
});
