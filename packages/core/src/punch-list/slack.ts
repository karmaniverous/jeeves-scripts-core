/**
 * @module punch-list/slack
 *
 * Mechanical Slack posts: the punch-list runnables post, and edit the
 * pinned quick-links message, with a gateway Slack account's bot token
 * through core's Slack client. No worker ever posts. Network I/O only.
 */

import { slackBotToken } from '../lib/openclaw-config.js';
import { createSlackClient } from '../lib/slack-client.js';

/** What the runnables need from Slack; injectable for tests. */
export interface SlackPort {
  /** Post `text` to a channel (or user) id. */
  post: (channel: string, text: string) => Promise<void>;
  /** Replace the text of message `ts` in `channel`. */
  update: (channel: string, ts: string, text: string) => Promise<void>;
}

/** The live port for one gateway Slack account. */
export const liveSlack = (account: string): SlackPort => {
  const client = createSlackClient({ token: slackBotToken(account) });
  return {
    post: async (channel, text) => {
      await client.postMessage(channel, text);
    },
    update: async (channel, ts, text) => {
      await client.post('chat.update', { channel, ts, text });
    },
  };
};
