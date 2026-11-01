/**
 * @module slack/channel-meta/report-md
 *
 * Markdown pieces of the report file (`channel-meta/report`,
 * `channel-meta/report-fields`): escaped prose, inline code, a channel's label
 * and a titled list. Pure.
 */

import type { ChannelFacts } from './gather.js';

/** Markdown-escape prose (names, generated text, error messages). */
export const mdText = (s: string): string =>
  s.replace(/[\\`*_[\]<>|#~]/g, (c) => `\\${c}`).replace(/\s+/g, ' ');

/** Inline code (back-ticks inside become `'`). */
export const code = (s: string): string => `\`${s.replace(/`/g, "'")}\``;

/** A channel as `#name (`id`)`. */
export const label = (f: ChannelFacts): string =>
  `#${mdText(f.channel.name)} (${code(f.channel.id)})`;

/**
 * A titled bullet list, or nothing when it is empty.
 *
 * @param title - Bold title.
 * @param items - Bullets.
 * @param count - The count in the title (default: the bullets).
 * @returns Lines, starting with a blank one.
 */
export const list = (
  title: string,
  items: readonly string[],
  count = items.length,
): string[] =>
  items.length === 0
    ? []
    : [
        '',
        `**${title}** (${String(count)}):`,
        '',
        ...items.map((i) => `- ${i}`),
      ];
