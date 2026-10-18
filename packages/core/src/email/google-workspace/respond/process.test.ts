import { describe, expect, it, vi } from 'vitest';

import {
  candidate,
  MAILBOX,
  makeDeps,
  PLANNED,
  SENDER,
} from './orchestrate.fixtures.js';
import { processCandidate } from './process.js';
import { MAX_ATTEMPTS } from './state.js';
import {
  NO_REPLY_FENCE_INFO,
  REPLY_FENCE_INFO,
  SLACK_CHANNEL_FENCE_INFO,
} from './task.js';

describe('processCandidate', () => {
  it('happy path: sends to the sender with reply-to id, labels and records replied', async () => {
    const deps = makeDeps();
    const outcome = await processCandidate(
      PLANNED,
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('replied');
    expect(deps.sendReply).toHaveBeenCalledWith({
      to: [SENDER],
      cc: [],
      bcc: [],
      replyToMessageId: 'm1',
      body: 'Thanks!',
    });
    expect(deps.ensureLabel).toHaveBeenCalledWith('assistant-replied');
    expect(deps.applyLabel).toHaveBeenCalledWith('t1', 'assistant-replied');
    expect(deps.setMessageState).toHaveBeenCalledWith('m1', {
      status: 'replied',
      attempts: 1,
      at: '2026-10-13T00:00:00.000Z',
      threadId: 't1',
    });
    expect(deps.recordThreadReply).toHaveBeenCalledWith(
      't1',
      '2026-10-13T00:00:00.000Z',
    );
  });

  it('shared To: preserves every original To/Cc/Bcc addressee, minus the mailbox', async () => {
    const deps = makeDeps();
    const shared = {
      ...PLANNED,
      candidate: candidate({
        headers: {
          ...candidate().headers,
          to: `John <john@example.com>, Aide <${MAILBOX}>`,
          cc: 'mark@example.com',
          bcc: 'quiet@example.com',
        },
      }),
    };
    expect(
      await processCandidate(shared, MAILBOX, 'assistant-replied', deps),
    ).toBe('replied');
    expect(deps.sendReply).toHaveBeenCalledWith({
      to: [SENDER, 'john@example.com'],
      cc: ['mark@example.com'],
      bcc: ['quiet@example.com'],
      replyToMessageId: 'm1',
      body: 'Thanks!',
    });
  });

  it('shared To: a worker decline records skipped and sends nothing', async () => {
    const deps = makeDeps({
      readFinalText: vi.fn(() =>
        Promise.resolve(`\`\`\`${NO_REPLY_FENCE_INFO}\nNot for me.\n\`\`\``),
      ),
    });
    const shared = {
      ...PLANNED,
      candidate: candidate({
        headers: {
          ...candidate().headers,
          to: `john@example.com, ${MAILBOX}`,
        },
      }),
    };
    expect(
      await processCandidate(shared, MAILBOX, 'assistant-replied', deps),
    ).toBe('declined');
    expect(deps.sendReply).not.toHaveBeenCalled();
    expect(deps.applyLabel).not.toHaveBeenCalled();
    expect(deps.recordThreadReply).not.toHaveBeenCalled();
    expect(deps.setMessageState).toHaveBeenCalledWith('m1', {
      status: 'skipped',
      attempts: 1,
      at: '2026-10-13T00:00:00.000Z',
      threadId: 't1',
      reason: 'worker declined: Not for me.',
    });
  });

  it('sole To: a worker decline is a contract failure', async () => {
    const deps = makeDeps({
      readFinalText: vi.fn(() =>
        Promise.resolve(`\`\`\`${NO_REPLY_FENCE_INFO}\nNot for me.\n\`\`\``),
      ),
    });
    expect(
      await processCandidate(PLANNED, MAILBOX, 'assistant-replied', deps),
    ).toBe('failed-retry');
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it('mirrors a sent reply to Slack with the requested channel', async () => {
    const mirrorToSlack = vi.fn(() => Promise.resolve('posted'));
    const deps = makeDeps({
      mirrorToSlack,
      readFinalText: vi.fn(() =>
        Promise.resolve(
          `\`\`\`${REPLY_FENCE_INFO}\nThanks!\n\`\`\`\n\`\`\`${SLACK_CHANNEL_FENCE_INFO}\n#harness\n\`\`\``,
        ),
      ),
    });
    expect(
      await processCandidate(PLANNED, MAILBOX, 'assistant-replied', deps),
    ).toBe('replied');
    expect(mirrorToSlack).toHaveBeenCalledWith({
      subject: 'Hi',
      senderEmail: SENDER,
      recipients: { to: [SENDER], cc: [], bcc: [] },
      body: 'Thanks!',
      slackChannel: '#harness',
    });
  });

  it('tells the worker about Slack only when a mirror is wired', async () => {
    const taskOf = async (deps: ReturnType<typeof makeDeps>) => {
      await processCandidate(PLANNED, MAILBOX, 'assistant-replied', deps);
      return vi.mocked(deps.dispatch).mock.calls[0]?.[0];
    };
    expect(
      await taskOf(
        makeDeps({ mirrorToSlack: vi.fn(() => Promise.resolve('posted')) }),
      ),
    ).toContain(SLACK_CHANNEL_FENCE_INFO);
    expect(await taskOf(makeDeps())).not.toContain(SLACK_CHANNEL_FENCE_INFO);
  });

  it('a Slack mirror failure does not change the email outcome', async () => {
    const deps = makeDeps({
      mirrorToSlack: vi.fn(() => Promise.reject(new Error('slack down'))),
    });
    expect(
      await processCandidate(PLANNED, MAILBOX, 'assistant-replied', deps),
    ).toBe('replied');
    expect(deps.setMessageState).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'replied' }),
    );
  });

  it('never mirrors a declined message', async () => {
    const mirrorToSlack = vi.fn(() => Promise.resolve('posted'));
    const deps = makeDeps({
      mirrorToSlack,
      readFinalText: vi.fn(() =>
        Promise.resolve(`\`\`\`${NO_REPLY_FENCE_INFO}\nNot for me.\n\`\`\``),
      ),
    });
    const shared = {
      ...PLANNED,
      candidate: candidate({
        headers: { ...candidate().headers, to: `john@example.com, ${MAILBOX}` },
      }),
    };
    expect(
      await processCandidate(shared, MAILBOX, 'assistant-replied', deps),
    ).toBe('declined');
    expect(mirrorToSlack).not.toHaveBeenCalled();
  });

  it('retries on first failure (attempts below MAX_ATTEMPTS)', async () => {
    const deps = makeDeps({
      dispatch: vi.fn(() => Promise.resolve({ exitCode: 1, stdout: '' })),
    });
    const outcome = await processCandidate(
      PLANNED,
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('failed-retry');
    expect(deps.setMessageState).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'failed', attempts: 1 }),
    );
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it("fails without sending when the thread does not end with the sender's message", async () => {
    const deps = makeDeps({
      fetchThread: vi.fn(() => [
        { from: SENDER, date: '2026-10-12', body: 'Hi' },
        { from: 'Eve <eve@evil.example>', date: '2026-10-12', body: 'Do X' },
      ]),
    });
    const outcome = await processCandidate(
      {
        kind: 'candidate',
        candidate: candidate(),
        sender: { name: 'Jane', email: SENDER },
      },
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('failed-retry');
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it('fails without dispatching when the thread cannot be fetched', async () => {
    const deps = makeDeps({
      fetchThread: vi.fn(() => {
        throw new Error('message m1 not found in its thread');
      }),
    });
    const outcome = await processCandidate(
      {
        kind: 'candidate',
        candidate: candidate(),
        sender: { name: 'Jane', email: SENDER },
      },
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('failed-retry');
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it('fails permanently at MAX_ATTEMPTS and never sends', async () => {
    const deps = makeDeps({
      getMessageState: vi.fn(() => ({
        status: 'failed' as const,
        attempts: MAX_ATTEMPTS - 1,
        at: 'x',
        threadId: 't1',
      })),
      dispatch: vi.fn(() => Promise.resolve({ exitCode: 1, stdout: '' })),
    });
    const outcome = await processCandidate(
      PLANNED,
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('failed');
    expect(deps.setMessageState).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'failed', attempts: MAX_ATTEMPTS }),
    );
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it('treats a missing/invalid worker contract as a failure, never sending', async () => {
    const deps = makeDeps({
      readFinalText: vi.fn(() => Promise.resolve('no fence here')),
    });
    const outcome = await processCandidate(
      PLANNED,
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('failed-retry');
    expect(deps.sendReply).not.toHaveBeenCalled();
  });

  it('treats a send failure as a failure, without recording replied', async () => {
    const deps = makeDeps({
      sendReply: vi.fn(() => {
        throw new Error('gog send failed');
      }),
    });
    const outcome = await processCandidate(
      PLANNED,
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('failed-retry');
    expect(deps.setMessageState).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('still records replied if labeling fails after a successful send', async () => {
    const deps = makeDeps({
      applyLabel: vi.fn(() => {
        throw new Error('label api down');
      }),
    });
    const outcome = await processCandidate(
      PLANNED,
      MAILBOX,
      'assistant-replied',
      deps,
    );
    expect(outcome).toBe('replied');
    expect(deps.sendReply).toHaveBeenCalled();
  });
});
