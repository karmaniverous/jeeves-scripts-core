/**
 * The inline-size cap in file-content: the listed size, files.info size,
 * Content-Length and the bytes actually read are each checked against
 * MAX_INLINE_BYTES.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ slackApi: vi.fn() }));

vi.mock('./slack-api.js', () => ({
  RATE_LIMIT_MS: 0,
  sleep: () => Promise.resolve(),
  slackApi: mocks.slackApi,
}));

const { enrichFileContent, MAX_INLINE_BYTES } =
  await import('./file-content.js');
import type { SlackFileMetadata, SlackMessage } from './slack-api.js';

const textFile = (over: Partial<SlackFileMetadata> = {}) => ({
  id: 'F1',
  name: 'a.txt',
  filetype: 'text',
  mimetype: 'text/plain',
  ...over,
});

const messageWith = (file: SlackFileMetadata): SlackMessage => ({
  ts: '1',
  files: [file],
});

function filesInfo(extra: Record<string, unknown> = {}) {
  mocks.slackApi.mockResolvedValue({
    file: { url_private_download: 'https://files/F1', ...extra },
  });
}

/** A streamed body of `chunks` chunks of `size` bytes, counting reads. */
function streamedBody(chunks: number, size: number) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) {
        controller.close();
        return;
      }
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('file-content inline cap', () => {
  it('is 256 KiB', () => {
    expect(MAX_INLINE_BYTES).toBe(262_144);
  });

  it('skips a file whose listed size is over the cap without any request', async () => {
    const file = textFile({ size: MAX_INLINE_BYTES + 1 });
    await enrichFileContent(messageWith(file), 'tok');

    expect(mocks.slackApi).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(file).not.toHaveProperty('markdown');
    expect(file.markdownSkipped).toBe(
      'too large to inline: size 262145 bytes > 262144-byte cap',
    );
    expect(log).toHaveBeenCalledWith(
      '[slack/poll] Skipped content for file F1: ' +
        'too large to inline: size 262145 bytes > 262144-byte cap',
    );
  });

  it('skips a file whose files.info size is over the cap without downloading', async () => {
    filesInfo({ size: MAX_INLINE_BYTES * 2 });
    const file = textFile();
    await enrichFileContent(messageWith(file), 'tok');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(file.markdownSkipped).toMatch(/^too large to inline: size 524288/);
  });

  it('stops at a Content-Length over the cap without reading the body', async () => {
    filesInfo();
    const body = streamedBody(1, 10);
    fetchMock.mockResolvedValue(
      new Response(body.stream, {
        headers: { 'content-length': String(MAX_INLINE_BYTES + 1) },
      }),
    );
    const file = textFile();
    await enrichFileContent(messageWith(file), 'tok');

    expect(file).not.toHaveProperty('markdown');
    expect(file.markdownSkipped).toBe(
      'too large to inline: Content-Length 262145 bytes > 262144-byte cap',
    );
    expect(body.cancelled()).toBe(true);
  });

  it('stops reading once the body passes the cap when no length is given', async () => {
    filesInfo();
    const chunk = 64 * 1024;
    const body = streamedBody(100, chunk);
    fetchMock.mockResolvedValue(new Response(body.stream));
    const file = textFile();
    await enrichFileContent(messageWith(file), 'tok');

    expect(file).not.toHaveProperty('markdown');
    expect(file.markdownSkipped).toBe(
      'too large to inline: body over 262144 bytes > 262144-byte cap',
    );
    expect(body.cancelled()).toBe(true);
    // Five 64 KiB chunks pass 256 KiB; nowhere near all 100 are pulled.
    expect(body.pulled()).toBeLessThan(10);
  });

  it('inlines a file of exactly the cap', async () => {
    filesInfo({ size: MAX_INLINE_BYTES });
    const body = streamedBody(4, MAX_INLINE_BYTES / 4);
    fetchMock.mockResolvedValue(new Response(body.stream));
    const file = textFile({ size: MAX_INLINE_BYTES });
    await enrichFileContent(messageWith(file), 'tok');

    expect(file.markdown).toHaveLength(MAX_INLINE_BYTES);
    expect(file).not.toHaveProperty('markdownSkipped');
  });

  it('decodes multi-byte UTF-8 split across chunks', async () => {
    filesInfo();
    const bytes = Buffer.from('héllo ✓', 'utf8');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 2));
        controller.enqueue(bytes.subarray(2));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(stream));
    const file = textFile();
    await enrichFileContent(messageWith(file), 'tok');

    expect(file.markdown).toBe('héllo ✓');
  });

  it('leaves an already skipped file alone on re-poll', async () => {
    const file = textFile({ markdownSkipped: 'too large' });
    await enrichFileContent(messageWith(file), 'tok');
    expect(mocks.slackApi).not.toHaveBeenCalled();
  });
});
