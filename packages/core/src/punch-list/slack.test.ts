import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ postMessage: vi.fn(), post: vi.fn() }));
const core = vi.hoisted(() => ({
  createSlackClient: vi.fn(() => client),
  slackBotToken: vi.fn(() => 'xoxb-test'),
}));
vi.mock('../lib/slack-client.js', () => ({
  createSlackClient: core.createSlackClient,
}));
vi.mock('../lib/openclaw-config.js', () => ({
  slackBotToken: core.slackBotToken,
}));

import { liveSlack } from './slack.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('liveSlack', () => {
  it('uses the account’s bot token, posts, and edits with chat.update', async () => {
    const slack = liveSlack('default');
    expect(core.slackBotToken).toHaveBeenCalledWith('default');
    expect(core.createSlackClient).toHaveBeenCalledWith({ token: 'xoxb-test' });
    await slack.post('C1', 'hi');
    expect(client.postMessage).toHaveBeenCalledWith('C1', 'hi');
    await slack.update('C1', '1.2', 'new');
    expect(client.post).toHaveBeenCalledWith('chat.update', {
      channel: 'C1',
      ts: '1.2',
      text: 'new',
    });
  });
});
