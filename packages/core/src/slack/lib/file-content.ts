/**
 * @module slack/lib/file-content
 *
 * Inline the text of small Slack files (text, post, snippet) into a
 * polled message before it is written: `files.info` for the private
 * download URL, then the raw content. Canvases are skipped (they need
 * `canvases:read`, jeeves-tools #95).
 */

import {
  RATE_LIMIT_MS,
  slackApi,
  type SlackMessage,
  sleep,
} from './slack-api.js';

/** File types whose content can be fetched and inlined as text/markdown. */
const TEXT_EXTRACTABLE_TYPES = new Set(['text', 'post', 'snippet']);

/**
 * Fetch text content for extractable file types via Slack's url_private_download.
 * Mutates file entries in place, adding `markdown` field.
 * Canvas content requires `canvases:read` scope (jeeves-tools #95) — skipped.
 */
export async function enrichFileContent(
  msg: SlackMessage,
  token: string,
): Promise<void> {
  if (!msg.files || msg.files.length === 0) return;

  for (const file of msg.files) {
    // Skip if already has content (re-poll guard)
    if (file.markdown) continue;

    if (!TEXT_EXTRACTABLE_TYPES.has(file.filetype)) continue;

    // Fetch file info to get url_private_download
    try {
      await sleep(RATE_LIMIT_MS);
      const info = await slackApi('files.info', { file: file.id }, token);
      const fileInfo = info.file as Record<string, unknown> | undefined;
      const downloadUrl = fileInfo?.url_private_download as string | undefined;

      if (!downloadUrl) continue;

      // Fetch the raw content
      const resp = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) continue;

      let content = await resp.text();

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
