/**
 * Tests for gmail-message (pure message reading) and pending-followups
 * (follow-up rule against an in-memory store).
 */

import { describe, expect, it } from 'vitest';

import {
  addressesOf,
  collectAttachments,
  type GmailMessage,
  latestInternalDateMs,
  parseGmailMessage,
  toCacheMessage,
} from './gmail-message.js';
import {
  noDirectionTimes,
  trackDirection,
  updatePendingFollowUp,
  upsertPending,
} from './pending-followups.js';

const message = (over: Partial<GmailMessage> = {}): GmailMessage => ({
  id: 'm1',
  internalDate: '1000',
  labelIds: ['INBOX'],
  snippet: 'snip',
  payload: {
    headers: [
      { name: 'From', value: 'a@x' },
      { name: 'To', value: 'b@x, c@x' },
      { name: 'Date', value: 'Thu, 1 Oct 2026' },
    ],
    parts: [
      { filename: 'a.pdf', mimeType: 'application/pdf', body: { size: 3 } },
      { parts: [{ filename: 'b.txt', body: {} }] },
      { filename: '', body: { size: 1 } },
    ],
  },
  ...over,
});

describe('gmail-message', () => {
  it('reads headers, labels, direction and attachments', () => {
    expect(parseGmailMessage(message(), 'Thread subject')).toEqual({
      messageId: 'm1',
      internalDateMs: 1000,
      from: 'a@x',
      to: 'b@x, c@x',
      cc: '',
      subject: 'Thread subject',
      date: 'Thu, 1 Oct 2026',
      labels: ['INBOX'],
      direction: 'incoming',
      snippet: 'snip',
      attachments: [
        { filename: 'a.pdf', mimeType: 'application/pdf', size: 3 },
        { filename: 'b.txt', mimeType: '', size: 0 },
      ],
    });
  });

  it('marks SENT messages outgoing and skips messages without an id', () => {
    expect(
      parseGmailMessage(message({ labelIds: ['SENT'] }), '')?.direction,
    ).toBe('outgoing');
    expect(parseGmailMessage(message({ id: '' }), '')).toBeNull();
    expect(
      parseGmailMessage(message({ internalDate: undefined }), '')
        ?.internalDateMs,
    ).toBeNull();
  });

  it('builds the cache entry', () => {
    const p = parseGmailMessage(message({ payload: undefined }), 's');
    expect(p && toCacheMessage(p)).toEqual({
      messageId: 'm1',
      from: '',
      to: '',
      cc: '',
      date: null,
      internalDateMs: 1000,
      labels: ['INBOX'],
      snippet: 'snip',
      hasAttachments: false,
      attachments: [],
    });
    expect(collectAttachments(undefined)).toEqual([]);
  });

  it('splits address headers', () => {
    expect(addressesOf('a@x', ' b@x , c@x,', '')).toEqual([
      'a@x',
      'b@x',
      'c@x',
    ]);
  });

  it('finds the newest internal date, starting from the stored one', () => {
    const msgs = [
      message({ internalDate: '5' }),
      message({ internalDate: '9' }),
    ];
    expect(latestInternalDateMs(msgs, null)).toBe(9);
    expect(latestInternalDateMs(msgs, 20)).toBe(20);
    expect(latestInternalDateMs([], null)).toBeNull();
  });
});

/** In-memory runner item store. */
const store = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (ns: string, coll: string, key: string) =>
      items.get(`${ns}/${coll}/${key}`) ?? null,
    setItem: (ns: string, coll: string, key: string, value: string) => {
      items.set(`${ns}/${coll}/${key}`, value);
    },
  };
};

const parsed = (direction: 'incoming' | 'outgoing', ms: number | null) => ({
  ...(parseGmailMessage(message(), 'Proposal') ?? ({} as never)),
  direction,
  internalDateMs: ms,
  to: 'client@y',
});

describe('pending-followups', () => {
  it('upsertPending merges into an existing entry', () => {
    const s = store();
    upsertPending(s, { key: 'k', a: 1, b: 1 });
    upsertPending(s, { key: 'k', b: 2 });
    expect(JSON.parse(s.items.get('email/pending/k') ?? '')).toEqual({
      key: 'k',
      a: 1,
      b: 2,
    });
  });

  it('tracks the newest message in each direction', () => {
    const t = noDirectionTimes();
    trackDirection(t, parsed('outgoing', 10));
    trackDirection(t, parsed('outgoing', 5));
    trackDirection(t, parsed('incoming', 7));
    trackDirection(t, parsed('incoming', null));
    expect(t).toEqual({
      latestOutMs: 10,
      latestInMs: 7,
      latestOutMeta: { subject: 'Proposal', from: 'a@x', to: 'client@y' },
    });
  });

  const thread = {
    account: 'me@x',
    threadId: 't1',
    subject: 'Proposal for review',
    from: 'me@x',
    receiptCandidate: false,
    junkCandidate: false,
  };

  it('resolves the follow-up when a reply is newer than our message', () => {
    const s = store();
    const t = noDirectionTimes();
    trackDirection(t, parsed('outgoing', 10));
    trackDirection(t, parsed('incoming', 20));
    updatePendingFollowUp(s, thread, t);
    const [entry] = [...s.items.values()].map(
      (v) => JSON.parse(v) as Record<string, unknown>,
    );
    expect(entry).toMatchObject({
      account: 'me@x',
      threadId: 't1',
      status: 'resolved',
    });
  });

  it('records nothing for a thread we never wrote in', () => {
    const s = store();
    const t = noDirectionTimes();
    trackDirection(t, parsed('incoming', 20));
    updatePendingFollowUp(s, thread, t);
    expect(s.items.size).toBe(0);
  });

  it('marks pending when our message is newest and expects a reply, unless it is junk', () => {
    const t = noDirectionTimes();
    trackDirection(t, parsed('incoming', 5));
    trackDirection(t, parsed('outgoing', 10));
    const junk = store();
    updatePendingFollowUp(junk, { ...thread, junkCandidate: true }, t);
    expect(junk.items.size).toBe(0);

    const s = store();
    updatePendingFollowUp(s, thread, t);
    const entries = [...s.items.values()].map(
      (v) => JSON.parse(v) as Record<string, unknown>,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        key: 'me@x::t1',
        status: 'pending',
        subject: 'Proposal for review',
        pendingSince: new Date(10).toISOString(),
        to: 'client@y',
        noResponseNeeded: false,
      }),
    ]);
  });
});
