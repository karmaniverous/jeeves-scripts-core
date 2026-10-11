/**
 * @module slack/lib/file-content
 *
 * Inline the text of small Slack files (text, post, snippet) into a
 * polled message before it is written: `files.info` for the private
 * download URL, then the raw content. Canvases are skipped (they need
 * `canvases:read`, jeeves-tools #95).
 *
 * Files over {@link MAX_INLINE_BYTES} are not inlined: the size Slack
 * reports is checked before anything is fetched, a larger
 * `Content-Length` stops the download, and the body is read with a byte
 * limit. A skipped file records why in `markdownSkipped` and is logged.
 */

import {
  RATE_LIMIT_MS,
  slackApi,
  type SlackFileMetadata,
  type SlackMessage,
  sleep,
} from './slack-api.js';

/** File types whose content can be fetched and inlined as text/markdown. */
const TEXT_EXTRACTABLE_TYPES = new Set(['text', 'post', 'snippet']);

/** Largest file, in bytes, whose content is inlined (256 KiB). */
export const MAX_INLINE_BYTES = 256 * 1024;

const tooLarge = (what: string) =>
  `too large to inline: ${what} > ${String(MAX_INLINE_BYTES)}-byte cap`;

function skip(file: SlackFileMetadata, reason: string): void {
  file.markdownSkipped = reason;
  console.log(`[slack/poll] Skipped content for file ${file.id}: ${reason}`);
}

/**
 * Read a response body as UTF-8 text, at most `maxBytes`.
 *
 * @returns The text, or a skip reason when the body is over the limit.
 */
async function readCapped(
  resp: Response,
  maxBytes: number,
): Promise<{ text: string } | { skipped: string }> {
  const declared = Number(resp.headers.get('content-length'));
  if (declared > maxBytes) {
    await resp.body?.cancel();
    return { skipped: tooLarge(`Content-Length ${String(declared)} bytes`) };
  }
  if (!resp.body) return { text: '' };

  const stream: ReadableStream<Uint8Array> = resp.body;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { skipped: tooLarge(`body over ${String(maxBytes)} bytes`) };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

const sizeOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Fetch text content for extractable file types via Slack's url_private_download.
 * Mutates file entries in place, adding `markdown` (or `markdownSkipped`
 * when the file is over the inline cap).
 * Canvas content requires `canvases:read` scope (jeeves-tools #95) - skipped.
 */
export async function enrichFileContent(
  msg: SlackMessage,
  token: string,
): Promise<void> {
  if (!msg.files || msg.files.length === 0) return;

  for (const file of msg.files) {
    // Skip if already has content, or was already skipped (re-poll guard)
    if (file.markdown || file.markdownSkipped) continue;

    if (!TEXT_EXTRACTABLE_TYPES.has(file.filetype)) continue;

    const listedSize = sizeOf(file.size);
    if (listedSize !== undefined && listedSize > MAX_INLINE_BYTES) {
      skip(file, tooLarge(`size ${String(listedSize)} bytes`));
      continue;
    }

    // Fetch file info to get url_private_download
    try {
      await sleep(RATE_LIMIT_MS);
      const info = await slackApi('files.info', { file: file.id }, token);
      const fileInfo = info.file as Record<string, unknown> | undefined;
      const downloadUrl = fileInfo?.url_private_download as string | undefined;

      if (!downloadUrl) continue;

      const infoSize = sizeOf(fileInfo?.size);
      if (infoSize !== undefined && infoSize > MAX_INLINE_BYTES) {
        skip(file, tooLarge(`size ${String(infoSize)} bytes`));
        continue;
      }

      // Fetch the raw content
      const resp = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) continue;

      const body = await readCapped(resp, MAX_INLINE_BYTES);
      if ('skipped' in body) {
        skip(file, body.skipped);
        continue;
      }
      let content = body.text;

      // Wrap code snippets in fenced code block
      if (file.filetype === 'snippet') {
        const lang =
          (fileInfo?.pretty_type as string | undefined)
            ?.toLowerCase()
            .replace(/\s+/g, '') ?? '';
        content = `\`\`\`${lang}\n${content}\n\`\`\``;
      }

      file.markdown = content;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[slack/poll] Failed to fetch content for file ${file.id}: ${errMsg}`,
      );
    }
  }
}
