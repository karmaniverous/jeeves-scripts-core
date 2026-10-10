/**
 * @module slack/lib/channel-config
 *
 * What this instance decides about a Slack channel: `slack.channels` in
 * `jeeves-scripts.json` (project tag, home directory). The single source
 * for those decisions; everything else about a channel comes from Slack
 * (see slack-cache).
 */

import { loadConfig, type LoadConfigOptions } from '../../config/loader.js';
import type { SlackChannelConfig } from '../../config/slack-schema.js';

/** Every configured channel, keyed by channel id. */
export const channelConfigs = (
  options: LoadConfigOptions = {},
): Record<string, SlackChannelConfig> => loadConfig(options).slack.channels;

/**
 * A channel's configured project and home directory.
 *
 * @returns `undefined` when the channel has no entry in `slack.channels`.
 */
export const getChannelConfig = (
  channelId: string,
  options: LoadConfigOptions = {},
): SlackChannelConfig | undefined =>
  Object.hasOwn(channelConfigs(options), channelId)
    ? channelConfigs(options)[channelId]
    : undefined;
