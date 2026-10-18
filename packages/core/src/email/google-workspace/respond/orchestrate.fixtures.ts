/**
 * Shared fixtures for the email-respond plan/process/orchestrate tests.
 */

import { vi } from 'vitest';

import type { CandidateMessage } from './candidates.js';
import type { RunDeps } from './process.js';
import { REPLY_FENCE_INFO } from './task.js';

export const MAILBOX = 'aide@example.com';
export const SENDER = 'jane@example.com';
const PASS_DKIM =
  'mx.google.com; dkim=pass header.i=@example-com.20251104.gappssmtp.com';

export function candidate(
  overrides: Partial<CandidateMessage> = {},
): CandidateMessage {
  return {
    messageId: 'm1',
    threadId: 't1',
    subject: 'Hi',
    internalDateMs: 1000,
    headers: {
      from: `Jane <${SENDER}>`,
      to: `Aide <${MAILBOX}>`,
      cc: '',
      bcc: '',
      authenticationResults: [PASS_DKIM],
      autoSubmitted: '',
      listId: '',
      precedence: '',
    },
    ...overrides,
  };
}

export const CONFIG = {
  mailbox: MAILBOX,
  allowedSenders: [SENDER],
  maxRepliesPerThreadPerHour: 3,
  maxPerRun: 3,
};

export function makeDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  return {
    getMessageState: vi.fn(() => null),
    setMessageState: vi.fn(),
    threadReplyCountSince: vi.fn(() => 0),
    recordThreadReply: vi.fn(),
    fetchThread: vi.fn(() => [
      { from: SENDER, date: '2026-10-12', body: 'Hi' },
    ]),
    dispatch: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: 'ok' })),
    readFinalText: vi.fn(() =>
      Promise.resolve(`\`\`\`${REPLY_FENCE_INFO}\nThanks!\n\`\`\``),
    ),
    sendReply: vi.fn(),
    ensureLabel: vi.fn(),
    applyLabel: vi.fn(),
    now: () => '2026-10-13T00:00:00.000Z',
    log: vi.fn(),
    ...overrides,
  };
}

export const PLANNED = {
  kind: 'candidate' as const,
  candidate: candidate(),
  sender: { name: 'Jane', email: SENDER },
};
