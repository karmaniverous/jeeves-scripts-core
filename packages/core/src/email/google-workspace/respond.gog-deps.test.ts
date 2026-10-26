/**
 * Tests for the gog-backed email-respond side effects (`gogRespondDeps`):
 * reply send arguments, label creation and application.
 */

import fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { gogRespondDeps } from './respond.js';

const MAILBOX = 'aide@example.com';

describe('gogRespondDeps', () => {
  it('sends with explicit recipients, never --reply-all, and cleans up the body file', () => {
    const calls: string[][] = [];
    let body = '';
    const gog = vi.fn((args: string[]) => {
      calls.push(args);
      const file = args[args.indexOf('--body-file') + 1] ?? '';
      body = fs.readFileSync(file, 'utf8');
      return '{}';
    });
    gogRespondDeps(gog, MAILBOX).sendReply({
      to: ['a@x.com', 'b@x.com'],
      cc: ['c@x.com'],
      bcc: ['d@x.com'],
      replyToMessageId: 'm1',
      body: 'Hello',
    });
    const args = calls[0] ?? [];
    expect(args).toEqual(
      expect.arrayContaining([
        '--to',
        'a@x.com,b@x.com',
        '--cc',
        'c@x.com',
        '--bcc',
        'd@x.com',
        '--reply-to-message-id',
        'm1',
      ]),
    );
    expect(args).not.toContain('--reply-all');
    expect(body).toBe('Hello');
    expect(fs.existsSync(args[args.indexOf('--body-file') + 1] ?? '')).toBe(
      false,
    );
  });

  it('omits empty Cc and Bcc', () => {
    const gog = vi.fn((_args: string[]) => '{}');
    gogRespondDeps(gog, MAILBOX).sendReply({
      to: ['a@x.com'],
      cc: [],
      bcc: [],
      replyToMessageId: 'm1',
      body: 'x',
    });
    const args = gog.mock.calls[0]?.[0] ?? [];
    expect(args).not.toContain('--cc');
    expect(args).not.toContain('--bcc');
  });

  it('creates the label only when it is missing', () => {
    const present = vi.fn((args: string[]) =>
      args.includes('list')
        ? JSON.stringify({ labels: [{ id: 'L1', name: 'assistant-replied' }] })
        : '',
    );
    gogRespondDeps(present, MAILBOX).ensureLabel('assistant-replied');
    expect(present).toHaveBeenCalledTimes(1);

    const missing = vi.fn((args: string[]) =>
      args.includes('list') ? JSON.stringify({ labels: [] }) : '',
    );
    gogRespondDeps(missing, MAILBOX).ensureLabel('assistant-replied');
    expect(missing).toHaveBeenLastCalledWith([
      'gmail',
      'labels',
      'create',
      'assistant-replied',
      '--account',
      MAILBOX,
    ]);

    const empty = vi.fn((_args: string[]) => '');
    gogRespondDeps(empty, MAILBOX).ensureLabel('assistant-replied');
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('applies the label to the thread', () => {
    const gog = vi.fn((_args: string[]) => '');
    gogRespondDeps(gog, MAILBOX).applyLabel('t1', 'assistant-replied');
    expect(gog).toHaveBeenCalledWith([
      'gmail',
      'thread',
      'modify',
      't1',
      '--add',
      'assistant-replied',
      '--account',
      MAILBOX,
    ]);
  });
});
