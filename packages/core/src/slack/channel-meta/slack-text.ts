/**
 * @module lib/slack-text
 *
 * Slack's three control characters (`&`, `<`, `>`) both ways: escape text
 * a job posts, so `<!channel>` or `<@U123>` in it is shown, not acted on;
 * decode text Slack returns (message text, a channel's purpose or topic),
 * where they arrive as `&amp;`, `&lt;`, `&gt;`. Pure.
 */

/**
 * Escape `&`, `<` and `>` for a Slack message.
 *
 * @param s - Plain text.
 * @returns Slack-safe text.
 */
export const escapeSlack = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Decode `&lt;`, `&gt;` and `&amp;` in text from Slack.
 *
 * @param s - Slack text.
 * @returns Plain text.
 */
export const decodeSlack = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
