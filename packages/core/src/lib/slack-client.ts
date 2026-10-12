/**
 * @module lib/slack-client
 *
 * The one Slack Web API client (root export): `createSlackClient({ token })`
 * returns typed calls over `fetch` (injectable): generic GET and JSON POST
 * methods, `chat.postMessage`, `conversations.open`, the external file
 * upload flow and authenticated file downloads. Every Web API call throws
 * a {@link SlackApiError} unless Slack answers `ok`, and retries an HTTP 429
 * after its `Retry-After` (lib/retry). Network I/O only; the token always
 * comes from the caller.
 */

import { z } from 'zod';

import { retryAsync } from './retry.js';

/** The Slack Web API base URL. */
const SLACK_API = 'https://slack.com/api/';

/** Tries per Web API call while Slack answers 429. */
const DEFAULT_RATE_LIMIT_ATTEMPTS = 3;

/** The wait when a 429 carries no usable `Retry-After`. */
const DEFAULT_RETRY_AFTER_MS = 1000;

/** A Slack Web API call that failed: Slack's error code, or why the response was unusable. */
export class SlackApiError extends Error {
  /**
   * @param method - The Web API method, e.g. `chat.postMessage`.
   * @param code - Slack's `error` (`channel_not_found`, `ratelimited`, …), or `invalid_response` for a body that is not JSON.
   * @param detail - Replaces the code in the message when given.
   */
  constructor(
    readonly method: string,
    readonly code: string,
    detail = code,
  ) {
    super(`Slack ${method} failed: ${detail}`);
    this.name = 'SlackApiError';
  }
}

/** Thrown inside the retry loop for a 429; carries the wait. */
class RateLimited extends SlackApiError {
  constructor(
    method: string,
    readonly waitMs: number,
  ) {
    super(method, 'ratelimited');
  }
}

/** Options for {@link createSlackClient}. */
export interface SlackClientOptions {
  /** The bot or user token (`xoxb-…`), from the caller's config. */
  token: string;
  /** The `fetch` to use; default the global one, read at call time. */
  fetch?: typeof fetch;
  /** Tries per Web API call while Slack answers 429 (default 3). */
  rateLimitAttempts?: number;
  /** The wait between 429 retries; default `sleepAsync`. */
  sleep?: (ms: number) => Promise<void>;
}

/** A successful Web API response body (`ok: true` plus the method's fields). */
export type SlackResponse = Record<string, unknown>;

/** A file to upload and share through {@link SlackClient.uploadFile}. */
export interface SlackFileUpload {
  /** The file's bytes. */
  bytes: Uint8Array;
  /** The file name Slack shows. */
  filename: string;
  /** The channel (or DM) id to share it to. */
  channelId: string;
  /** The file title; default the file name. */
  title?: string;
  /** A message posted with the file. */
  initialComment?: string;
  /** The MIME type of the uploaded bytes; default `application/octet-stream`. */
  contentType?: string;
}

/** Options for {@link SlackClient.postMessage}. */
export interface SlackPostMessageOptions {
  /** Reply in the thread of this message `ts`. */
  threadTs?: string;
}

/** Where {@link SlackClient.postMessage} posted. */
export interface SlackPostedMessage {
  /** The channel id. */
  channel: string;
  /** The message `ts`. */
  ts: string;
}

/** The Slack Web API calls core and instances use. */
export interface SlackClient {
  /** GET a Web API method with query parameters (read methods: `conversations.history`, `auth.test`, …). */
  call: (
    method: string,
    params?: Record<string, string>,
  ) => Promise<SlackResponse>;
  /** POST a JSON body to a Web API method. */
  post: (
    method: string,
    body: Record<string, unknown>,
  ) => Promise<SlackResponse>;
  /** Post `text` to a channel, DM or thread (`chat.postMessage`); resolves the message's channel and `ts`. */
  postMessage: (
    channel: string,
    text: string,
    options?: SlackPostMessageOptions,
  ) => Promise<SlackPostedMessage>;
  /** Open (or reuse) the token's DM with `userId` (`conversations.open`); resolves the channel id. */
  openDm: (userId: string) => Promise<string>;
  /**
   * Upload and share a file: `files.getUploadURLExternal`, POST the bytes
   * (an HTTP error throws "Slack file upload failed: HTTP status for
   * filename"), `files.completeUploadExternal`. Resolves the file id.
   */
  uploadFile: (file: SlackFileUpload) => Promise<string>;
  /** GET a file URL (`url_private_download`) with the token; resolves the raw response. */
  download: (url: string) => Promise<Response>;
}

const okSchema = z.looseObject({
  ok: z.boolean(),
  error: z.string().optional(),
});
const messageSchema = z.object({ channel: z.string(), ts: z.string() });
const dmSchema = z.looseObject({ channel: z.object({ id: z.string() }) });
const reservedSchema = z.looseObject({
  upload_url: z.string(),
  file_id: z.string(),
});

/** Seconds in a `Retry-After` header as milliseconds. */
const retryAfterMs = (res: Response): number => {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_RETRY_AFTER_MS;
};

/** A response body as a Slack result; throws unless `ok`. */
async function checked(method: string, res: Response): Promise<SlackResponse> {
  if (res.status === 429) throw new RateLimited(method, retryAfterMs(res));
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SlackApiError(
      method,
      'invalid_response',
      `HTTP ${String(res.status)}, body is not JSON: ${text.slice(0, 200)}`,
    );
  }
  const parsed = okSchema.safeParse(body);
  if (!parsed.success)
    throw new SlackApiError(method, 'invalid_response', 'no ok field');
  if (!parsed.data.ok)
    throw new SlackApiError(method, parsed.data.error ?? 'unknown');
  return parsed.data;
}

/**
 * A Slack Web API client for one token.
 *
 * @example
 * ```ts
 * const slack = createSlackClient({ token: slackBotToken() });
 * await slack.postMessage('C000EXAMPLE1', 'Report ready.');
 * ```
 */
export function createSlackClient(options: SlackClientOptions): SlackClient {
  const { token } = options;
  const doFetch: typeof fetch = (input, init) =>
    (options.fetch ?? globalThis.fetch)(input, init);
  const auth = { Authorization: `Bearer ${token}` };

  /** One Web API request, retried while Slack answers 429. */
  const request = (method: string, send: () => Promise<Response>) => {
    let waitMs = 0;
    return retryAsync(
      async () => {
        try {
          return await checked(method, await send());
        } catch (err) {
          if (err instanceof RateLimited) waitMs = err.waitMs;
          throw err;
        }
      },
      {
        attempts: options.rateLimitAttempts ?? DEFAULT_RATE_LIMIT_ATTEMPTS,
        isRetryable: (err) => err instanceof RateLimited,
        delayMs: () => waitMs,
        ...(options.sleep ? { sleep: options.sleep } : {}),
      },
    );
  };

  const call: SlackClient['call'] = (method, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(method, () =>
      doFetch(`${SLACK_API}${method}${qs ? `?${qs}` : ''}`, { headers: auth }),
    );
  };

  const post: SlackClient['post'] = (method, body) =>
    request(method, () =>
      doFetch(`${SLACK_API}${method}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      }),
    );

  return {
    call,
    post,
    postMessage: async (channel, text, opts = {}) =>
      messageSchema.parse(
        await post('chat.postMessage', {
          channel,
          text,
          ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
        }),
      ),
    openDm: async (userId) =>
      dmSchema.parse(await post('conversations.open', { users: userId }))
        .channel.id,
    uploadFile: async (file) => {
      const reserved = reservedSchema.parse(
        await call('files.getUploadURLExternal', {
          filename: file.filename,
          length: String(file.bytes.length),
        }),
      );
      const uploaded = await doFetch(reserved.upload_url, {
        method: 'POST',
        headers: {
          'Content-Type': file.contentType ?? 'application/octet-stream',
        },
        body: file.bytes,
      });
      if (!uploaded.ok)
        throw new Error(
          `Slack file upload failed: HTTP ${String(uploaded.status)} for ${file.filename}`,
        );
      await post('files.completeUploadExternal', {
        files: [{ id: reserved.file_id, title: file.title ?? file.filename }],
        channel_id: file.channelId,
        ...(file.initialComment !== undefined
          ? { initial_comment: file.initialComment }
          : {}),
      });
      return reserved.file_id;
    },
    download: (url) => doFetch(url, { headers: auth }),
  };
}
