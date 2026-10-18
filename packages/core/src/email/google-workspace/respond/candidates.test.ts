import { describe, expect, it, vi } from 'vitest';

import { searchArgs } from '../gmail-search.js';
import {
  discoverCandidateThreadIds,
  fetchThreadCandidates,
  messageMetadataArgs,
  parseCandidateMessage,
  parseThreadMessageIds,
  RESPOND_HEADER_NAMES,
  RESPOND_SEARCH_QUERY,
  threadGetArgs,
} from './candidates.js';

describe('threadGetArgs / messageMetadataArgs', () => {
  it('builds gog gmail thread get args', () => {
    expect(threadGetArgs('aide@example.com', 't1')).toEqual([
      'gmail',
      'thread',
      'get',
      't1',
      '--json',
      '--account',
      'aide@example.com',
    ]);
  });

  it('builds gog gmail get metadata args with every needed header', () => {
    const args = messageMetadataArgs('aide@example.com', 'm1');
    expect(args).toEqual([
      'gmail',
      'get',
      'm1',
      '--format',
      'metadata',
      '--headers',
      RESPOND_HEADER_NAMES.join(','),
      '--json',
      '--account',
      'aide@example.com',
    ]);
  });
});

describe('parseThreadMessageIds', () => {
  it('parses message ids oldest first, as returned', () => {
    const raw = JSON.stringify({
      thread: { messages: [{ id: 'm1' }, { id: 'm2' }] },
    });
    expect(parseThreadMessageIds(raw)).toEqual(['m1', 'm2']);
  });

  it('returns empty array for empty input', () => {
    expect(parseThreadMessageIds('')).toEqual([]);
  });

  it('drops messages without an id', () => {
    const raw = JSON.stringify({ thread: { messages: [{}, { id: 'm2' }] } });
    expect(parseThreadMessageIds(raw)).toEqual(['m2']);
  });
});

describe('parseCandidateMessage', () => {
  function rawMessage(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      message: {
        id: 'm1',
        threadId: 't1',
        internalDate: '1760313600000',
        payload: {
          headers: [
            { name: 'Subject', value: 'Hi' },
            { name: 'From', value: 'jane@example.com' },
            { name: 'To', value: 'aide@example.com' },
            {
              name: 'Authentication-Results',
              value: 'mx.google.com; dkim=pass',
            },
          ],
        },
        ...overrides,
      },
    });
  }

  it('parses message id, thread id, subject, date and headers', () => {
    const parsed = parseCandidateMessage(rawMessage());
    expect(parsed.messageId).toBe('m1');
    expect(parsed.threadId).toBe('t1');
    expect(parsed.subject).toBe('Hi');
    expect(parsed.internalDateMs).toBe(1760313600000);
    expect(parsed.headers.from).toBe('jane@example.com');
    expect(parsed.headers.to).toBe('aide@example.com');
    expect(parsed.headers.authenticationResults).toEqual([
      'mx.google.com; dkim=pass',
    ]);
  });

  it('parses Cc and Bcc, defaulting to empty when absent', () => {
    expect(parseCandidateMessage(rawMessage()).headers.bcc).toBe('');
    const raw = JSON.stringify({
      message: {
        id: 'm1',
        threadId: 't1',
        payload: {
          headers: [
            { name: 'Cc', value: 'mark@example.com' },
            { name: 'Bcc', value: 'quiet@example.com' },
          ],
        },
      },
    });
    const { headers } = parseCandidateMessage(raw);
    expect(headers.cc).toBe('mark@example.com');
    expect(headers.bcc).toBe('quiet@example.com');
  });

  it('requests the Bcc header', () => {
    expect(RESPOND_HEADER_NAMES).toContain('Bcc');
  });

  it('collects every Authentication-Results header value, in order', () => {
    const raw = JSON.stringify({
      message: {
        id: 'm1',
        threadId: 't1',
        payload: {
          headers: [
            { name: 'Authentication-Results', value: 'top' },
            { name: 'Authentication-Results', value: 'bottom' },
          ],
        },
      },
    });
    expect(parseCandidateMessage(raw).headers.authenticationResults).toEqual([
      'top',
      'bottom',
    ]);
  });

  it('throws when message.id or message.threadId is missing', () => {
    expect(() =>
      parseCandidateMessage(JSON.stringify({ message: { id: 'm1' } })),
    ).toThrow(/message\.id or message\.threadId/);
  });
});

describe('discoverCandidateThreadIds', () => {
  it('yields deduplicated thread ids across pages', () => {
    const pages = [
      JSON.stringify({ threads: [{ threadId: 't1' }], nextPageToken: 'p2' }),
      JSON.stringify({
        threads: [{ threadId: 't1' }, { threadId: 't2' }],
        nextPageToken: '',
      }),
    ];
    let i = 0;
    const gog = vi.fn(() => pages[i++] ?? '');
    const ids = [...discoverCandidateThreadIds(gog, 'aide@example.com')];
    expect(ids).toEqual(['t1', 't2']);
    expect(gog).toHaveBeenCalledTimes(2);
    // The candidate query, on the mailbox, with the second page's token.
    expect(gog.mock.calls.map((c) => (c as string[][])[0])).toEqual([
      searchArgs('aide@example.com', RESPOND_SEARCH_QUERY, 100),
      searchArgs('aide@example.com', RESPOND_SEARCH_QUERY, 100, 'p2'),
    ]);
  });

  it('throws on a repeated page token instead of looping forever', () => {
    const gog = vi.fn(() =>
      JSON.stringify({ threads: [{ threadId: 't1' }], nextPageToken: 'p2' }),
    );
    expect(() => [
      ...discoverCandidateThreadIds(gog, 'aide@example.com'),
    ]).toThrow(/repeated page token/);
  });
});

describe('fetchThreadCandidates', () => {
  it('fetches every message in the thread, dropping messages from the mailbox', () => {
    const mailbox = 'aide@example.com';
    const threadRaw = JSON.stringify({
      thread: { messages: [{ id: 'm1' }, { id: 'm2' }] },
    });
    const m1 = JSON.stringify({
      message: {
        id: 'm1',
        threadId: 't1',
        payload: { headers: [{ name: 'From', value: 'jane@example.com' }] },
      },
    });
    const m2 = JSON.stringify({
      message: {
        id: 'm2',
        threadId: 't1',
        payload: {
          headers: [{ name: 'From', value: `Aide <${mailbox}>` }],
        },
      },
    });
    const gog = vi
      .fn()
      .mockReturnValueOnce(threadRaw)
      .mockReturnValueOnce(m1)
      .mockReturnValueOnce(m2);
    const candidates = fetchThreadCandidates(gog, mailbox, 't1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.messageId).toBe('m1');
  });

  it('drops a message whose From is the bare mailbox address', () => {
    const mailbox = 'aide@example.com';
    const threadRaw = JSON.stringify({ thread: { messages: [{ id: 'm1' }] } });
    const m1 = JSON.stringify({
      message: {
        id: 'm1',
        threadId: 't1',
        payload: { headers: [{ name: 'From', value: mailbox }] },
      },
    });
    const gog = vi.fn().mockReturnValueOnce(threadRaw).mockReturnValueOnce(m1);
    expect(fetchThreadCandidates(gog, mailbox, 't1')).toEqual([]);
  });
});
