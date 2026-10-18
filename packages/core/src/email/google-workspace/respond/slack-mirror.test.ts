import { describe, expect, it, vi } from 'vitest';

import {
  chooseMirrorTarget,
  formatMirrorPost,
  initSlackDirectory,
  MAX_MIRROR_BODY,
  mirrorReply,
  type SlackDirectory,
} from './slack-mirror.js';

function dir(overrides: Partial<SlackDirectory> = {}): SlackDirectory {
  return {
    lookupUserByEmail: vi.fn(() => Promise.resolve('U123MARK')),
    resolveChannel: vi.fn(() =>
      Promise.resolve({ id: 'C123HARN', isMember: true }),
    ),
    isChannelMember: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe('chooseMirrorTarget', () => {
  it("defaults to the sender's DM", async () => {
    const d = dir();
    expect(await chooseMirrorTarget(d, 'mark@example.com')).toEqual({
      post: true,
      target: 'user:U123MARK',
    });
    expect(d.resolveChannel).not.toHaveBeenCalled();
  });

  it('does not post when the sender has no Slack user', async () => {
    const d = dir({ lookupUserByEmail: vi.fn(() => Promise.resolve(null)) });
    expect(await chooseMirrorTarget(d, 'x@example.com', '#harness')).toEqual({
      post: false,
      reason: 'no Slack user for x@example.com',
    });
  });

  it('posts to a requested channel when both are members', async () => {
    const d = dir();
    expect(await chooseMirrorTarget(d, 'mark@example.com', '#harness')).toEqual(
      {
        post: true,
        target: 'channel:C123HARN',
      },
    );
    expect(d.isChannelMember).toHaveBeenCalledWith('C123HARN', 'U123MARK');
  });

  it('falls back to the DM when the channel is unknown', async () => {
    const d = dir({ resolveChannel: vi.fn(() => Promise.resolve(null)) });
    const choice = await chooseMirrorTarget(d, 'mark@example.com', '#nope');
    expect(choice).toMatchObject({ post: true, target: 'user:U123MARK' });
  });

  it('falls back to the DM when the assistant is not in the channel', async () => {
    const d = dir({
      resolveChannel: vi.fn(() =>
        Promise.resolve({ id: 'C123HARN', isMember: false }),
      ),
    });
    const choice = await chooseMirrorTarget(d, 'mark@example.com', '#harness');
    expect(choice).toMatchObject({ post: true, target: 'user:U123MARK' });
    expect(d.isChannelMember).not.toHaveBeenCalled();
  });

  it('falls back to the DM when the sender is not in the channel', async () => {
    const d = dir({ isChannelMember: vi.fn(() => Promise.resolve(false)) });
    const choice = await chooseMirrorTarget(d, 'mark@example.com', '#harness');
    expect(choice).toMatchObject({
      post: true,
      target: 'user:U123MARK',
      note: 'sender is not in #harness; posted to DM',
    });
  });
});

describe('chooseMirrorTarget: verification errors', () => {
  it.each([
    [
      'channel resolution',
      { resolveChannel: vi.fn(() => Promise.reject(new Error('ratelimited'))) },
    ],
    [
      'the membership check',
      {
        isChannelMember: vi.fn(() => Promise.reject(new Error('ratelimited'))),
      },
    ],
  ])('falls back to the DM when %s fails', async (_label, overrides) => {
    expect(
      await chooseMirrorTarget(dir(overrides), 'mark@example.com', '#harness'),
    ).toEqual({
      post: true,
      target: 'user:U123MARK',
      note: 'could not verify #harness (ratelimited); posted to DM',
    });
  });
});

describe('initSlackDirectory', () => {
  it('returns null without calling the factory when disabled', () => {
    const factory = vi.fn(() => dir());
    expect(initSlackDirectory(false, factory, vi.fn())).toBe(null);
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns the directory when setup succeeds', () => {
    const d = dir();
    const log = vi.fn();
    expect(initSlackDirectory(true, () => d, log)).toBe(d);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs and disables the mirror when there is no token', () => {
    const log = vi.fn();
    expect(initSlackDirectory(true, () => null, log)).toBe(null);
    expect(log).toHaveBeenCalledWith(
      '[email-respond] no Slack bot token; Slack mirror disabled',
    );
  });

  it('logs and disables the mirror, without throwing, when setup throws', () => {
    const log = vi.fn();
    const throwing = () => {
      throw new Error('Invalid Slack config in /x/openclaw.json');
    };
    expect(initSlackDirectory(true, throwing, log)).toBe(null);
    expect(log).toHaveBeenCalledWith(
      '[email-respond] Slack mirror disabled: setup failed: Invalid Slack config in /x/openclaw.json',
    );
  });
});

describe('formatMirrorPost', () => {
  const base = {
    subject: 'Harness',
    senderEmail: 'mark@example.com',
    recipients: {
      to: ['mark@example.com', 'john@example.com'],
      cc: ['jane@example.com'],
      bcc: ['secret@example.com'],
    },
    body: 'Here is the summary.',
  };

  it('shows subject, To and Cc, and the body', () => {
    const text = formatMirrorPost(base);
    expect(text).toContain('**Email reply:** Harness');
    expect(text).toContain('mark@example.com, john@example.com');
    expect(text).toContain('Cc: jane@example.com');
    expect(text).toContain('Here is the summary.');
  });

  it('never reveals Bcc addressees', () => {
    expect(formatMirrorPost(base)).not.toContain('secret@example.com');
  });

  it('truncates bodies longer than MAX_MIRROR_BODY, and only those', () => {
    const atLimit = 'x'.repeat(MAX_MIRROR_BODY);
    expect(formatMirrorPost({ ...base, body: atLimit })).toMatch(
      new RegExp(`\\n\\n${atLimit}$`),
    );
    const over = formatMirrorPost({ ...base, body: `${atLimit}yyy` });
    expect(over).toContain(`${atLimit}\n\n…(truncated`);
    expect(over).not.toContain('xyyy');
  });
});

describe('mirrorReply', () => {
  const input = {
    subject: 'Harness',
    senderEmail: 'mark@example.com',
    recipients: { to: ['mark@example.com'], cc: [], bcc: [] },
    body: 'Done.',
  };

  it('posts the formatted reply to the chosen target and reports it', async () => {
    const send = vi.fn(() => Promise.resolve(undefined));
    const d = dir({ isChannelMember: vi.fn(() => Promise.resolve(false)) });
    expect(
      await mirrorReply(d, send, { ...input, slackChannel: '#harness' }),
    ).toBe('posted to user:U123MARK (sender is not in #harness; posted to DM)');
    expect(send).toHaveBeenCalledWith('user:U123MARK', formatMirrorPost(input));
  });

  it('sends nothing when there is no target', async () => {
    const send = vi.fn(() => Promise.resolve(undefined));
    const d = dir({ lookupUserByEmail: vi.fn(() => Promise.resolve(null)) });
    expect(await mirrorReply(d, send, input)).toBe(
      'not posted: no Slack user for mark@example.com',
    );
    expect(send).not.toHaveBeenCalled();
  });
});
