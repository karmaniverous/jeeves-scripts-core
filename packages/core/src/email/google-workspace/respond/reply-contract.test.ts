import { describe, expect, it } from 'vitest';

import { parseReplyContract } from './reply-contract.js';
import {
  NO_REPLY_FENCE_INFO,
  REPLY_FENCE_INFO,
  SLACK_CHANNEL_FENCE_INFO,
} from './task.js';

const SOLE = { allowNoReply: false };
const SHARED = { allowNoReply: true };

describe('parseReplyContract', () => {
  it('parses a reply that is exactly one block', () => {
    const text = `\n\`\`\`${REPLY_FENCE_INFO}\nThanks for reaching out!\n\`\`\`\n`;
    expect(parseReplyContract(text, SOLE)).toEqual({
      ok: true,
      kind: 'reply',
      body: 'Thanks for reaching out!',
    });
  });

  it('fails when there is text before or after the block', () => {
    const block = `\`\`\`${REPLY_FENCE_INFO}\nThanks!\n\`\`\``;
    for (const text of [`Some preamble.\n\n${block}`, `${block}\nP.S. more`]) {
      expect(parseReplyContract(text, SOLE)).toEqual({
        ok: false,
        reason: 'worker reply has text outside the contract fenced block',
      });
    }
  });

  it('fails when there is no block', () => {
    expect(parseReplyContract('just some text', SOLE)).toEqual({
      ok: false,
      reason: 'no email-reply fenced block in worker reply',
    });
  });

  it('fails when there is more than one block', () => {
    const text = `\`\`\`${REPLY_FENCE_INFO}\nOne\n\`\`\`\n\`\`\`${REPLY_FENCE_INFO}\nTwo\n\`\`\``;
    const result = parseReplyContract(text, SOLE);
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/expected exactly one/);
  });

  it('fails on an empty body', () => {
    const text = `\`\`\`${REPLY_FENCE_INFO}\n   \n\`\`\``;
    expect(parseReplyContract(text, SOLE)).toEqual({
      ok: false,
      reason: 'email-reply block body is empty',
    });
  });

  it('trims the body', () => {
    const text = `\`\`\`${REPLY_FENCE_INFO}\n\n  Hello there.  \n\n\`\`\``;
    expect(parseReplyContract(text, SOLE)).toEqual({
      ok: true,
      kind: 'reply',
      body: 'Hello there.',
    });
  });
});

describe('parseReplyContract: email-no-reply', () => {
  const decline = `\`\`\`${NO_REPLY_FENCE_INFO}\nJane already answered this.\n\`\`\``;

  it('accepts a decline when allowed (shared To)', () => {
    expect(parseReplyContract(decline, SHARED)).toEqual({
      ok: true,
      kind: 'no-reply',
      reason: 'Jane already answered this.',
    });
  });

  it('rejects a decline when the mailbox is the sole To addressee', () => {
    const result = parseReplyContract(decline, SOLE);
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/not allowed/);
  });

  it('rejects an empty decline reason', () => {
    const text = `\`\`\`${NO_REPLY_FENCE_INFO}\n  \n\`\`\``;
    expect(parseReplyContract(text, SHARED)).toEqual({
      ok: false,
      reason: 'email-no-reply block reason is empty',
    });
  });

  it('rejects a reply block plus a decline block', () => {
    const text = `\`\`\`${REPLY_FENCE_INFO}\nHi\n\`\`\`\n${decline}`;
    const result = parseReplyContract(text, SHARED);
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/expected exactly one/);
  });
});

describe('parseReplyContract: email-slack-channel', () => {
  const reply = `\`\`\`${REPLY_FENCE_INFO}\nDone.\n\`\`\``;
  const slack = (v: string) =>
    `\`\`\`${SLACK_CHANNEL_FENCE_INFO}\n${v}\n\`\`\``;

  it('returns the requested channel after a reply', () => {
    expect(parseReplyContract(`${reply}\n${slack('#harness')}`, SOLE)).toEqual({
      ok: true,
      kind: 'reply',
      body: 'Done.',
      slackChannel: '#harness',
    });
  });

  it('rejects a Slack block before the reply', () => {
    const result = parseReplyContract(`${slack('#harness')}\n${reply}`, SOLE);
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/must come last/);
  });

  it('rejects two Slack blocks', () => {
    const result = parseReplyContract(
      `${reply}\n${slack('#a')}\n${slack('#b')}`,
      SOLE,
    );
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/more than one/);
  });

  it('rejects a Slack block that is not a single channel', () => {
    const result = parseReplyContract(
      `${reply}\n${slack('#a and also #b')}`,
      SOLE,
    );
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/one channel name or id/);
  });

  it('rejects a Slack block with a decline', () => {
    const decline = `\`\`\`${NO_REPLY_FENCE_INFO}\nNot for me.\n\`\`\``;
    const result = parseReplyContract(`${decline}\n${slack('#a')}`, SHARED);
    if (result.ok) throw new Error('expected a contract failure');
    expect(result.reason).toMatch(/only allowed with a reply/);
  });
});
