/**
 * Tests for the modules split out of imap/poll: runner poll state
 * (poll-state) and cache writes (message-store).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  base: '',
  createOrUpdateCache: vi.fn(),
}));

vi.mock('../email-cache.js', () => ({
  getThreadsPath: (account: string, threadId: string) =>
    path.join(mocks.base, 'threads', account, threadId),
  createOrUpdateCache: mocks.createOrUpdateCache,
}));

const { loadState, saveState } = await import('./poll-state.js');
const { messageExists, writeMessage } = await import('./message-store.js');
import type { NormalizedMessage } from './normalize.js';

beforeEach(() => {
  mocks.base = fs.mkdtempSync(path.join(os.tmpdir(), 'imap-'));
});

afterEach(() => {
  fs.rmSync(mocks.base, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('poll-state', () => {
  it('keeps each account under the imap-poll namespace', () => {
    const store = new Map<string, string>();
    const client = {
      getState: (ns: string, key: string) => store.get(`${ns}/${key}`) ?? null,
      setState: (ns: string, key: string, value: string) =>
        store.set(`${ns}/${key}`, value),
    } as unknown as RunnerClient;

    expect(loadState('a@x', client)).toEqual({ folders: {} });
    const state = { folders: { INBOX: { uidValidity: 7, lastUid: 42 } } };
    saveState('a@x', state, client);
    expect([...store.keys()]).toEqual(['imap-poll/a@x']);
    expect(loadState('a@x', client)).toEqual(state);
  });
});

describe('message-store', () => {
  const msg = {
    headers: {
      subject: 'Hello',
      from: 'a@x',
      to: 'b@x',
      cc: '',
      date: 'Thu, 1 Oct 2026 10:00:00 +0000',
    },
    internalDate: new Date('2026-10-01T10:00:00Z'),
    computed: { snippet: 'hi' },
    body: { text: 'hi there' },
    attachments: [],
  } as unknown as NormalizedMessage;

  it('writes the message JSON and the thread cache entry', () => {
    expect(messageExists('a@x', 't1', 'm1')).toBe(false);
    writeMessage('a@x', 't1', 'm1', msg, ['INBOX']);
    expect(messageExists('a@x', 't1', 'm1')).toBe(true);

    const written = JSON.parse(
      fs.readFileSync(
        path.join(mocks.base, 'threads', 'a@x', 't1', 'm1.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(written).toMatchObject({
      messageId: 'm1',
      threadId: 't1',
      account: 'a@x',
      subject: 'Hello',
      internalDateMs: Date.parse('2026-10-01T10:00:00Z'),
      labels: ['INBOX'],
      body: { text: 'hi there' },
    });
    expect(mocks.createOrUpdateCache).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'a@x',
        threadId: 't1',
        participants: ['a@x', 'b@x'],
        messages: {
          m1: expect.objectContaining({
            snippet: 'hi',
            hasAttachments: false,
            labels: ['INBOX'],
          }) as unknown,
        },
      }),
    );
  });
});
