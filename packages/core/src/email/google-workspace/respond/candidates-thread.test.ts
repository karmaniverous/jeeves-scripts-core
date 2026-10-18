import { describe, expect, it } from 'vitest';

import { parseThreadForTask, threadFullArgs } from './candidates.js';

describe('parseThreadForTask', () => {
  it('renders sender, date and plain-text body per message, oldest first', () => {
    const raw = JSON.stringify({
      thread: {
        messages: [
          {
            id: 'm1',
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: 'Jane <jane@example.com>' },
                { name: 'Date', value: 'Tue, 13 Oct 2026 03:00:00 +0000' },
              ],
              body: { data: Buffer.from('first').toString('base64url') },
            },
          },
          {
            id: 'm2',
            payload: {
              mimeType: 'text/plain',
              headers: [{ name: 'From', value: 'aide@example.com' }],
              body: { data: Buffer.from('second').toString('base64url') },
            },
          },
        ],
      },
    });
    expect(parseThreadForTask(raw, 'm2')).toEqual([
      {
        from: 'Jane <jane@example.com>',
        date: 'Tue, 13 Oct 2026 03:00:00 +0000',
        body: 'first',
      },
      { from: 'aide@example.com', date: '', body: 'second' },
    ]);
  });

  it('stops at the message being answered, dropping later messages', () => {
    const raw = JSON.stringify({
      thread: {
        messages: [
          {
            id: 'm1',
            payload: { headers: [{ name: 'From', value: 'jane@example.com' }] },
          },
          {
            id: 'm2',
            payload: { headers: [{ name: 'From', value: 'eve@evil.example' }] },
          },
        ],
      },
    });
    expect(parseThreadForTask(raw, 'm1').map((m) => m.from)).toEqual([
      'jane@example.com',
    ]);
  });

  it('throws when the message is not in the thread', () => {
    const raw = JSON.stringify({ thread: { messages: [{ id: 'm1' }] } });
    expect(() => parseThreadForTask(raw, 'mX')).toThrow(
      'message mX not found in its thread',
    );
  });
});

describe('threadFullArgs', () => {
  it('asks gog for full bodies', () => {
    expect(threadFullArgs('aide@example.com', 't1')).toEqual([
      'gmail',
      'thread',
      'get',
      't1',
      '--json',
      '--account',
      'aide@example.com',
      '--full',
    ]);
  });
});
