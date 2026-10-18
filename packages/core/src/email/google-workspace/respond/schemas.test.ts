import { describe, expect, it } from 'vitest';

import {
  LabelsListResponseSchema,
  MessageGetResponseSchema,
  parseJsonWith,
  ThreadGetResponseSchema,
} from './schemas.js';

describe('parseJsonWith', () => {
  it('returns typed data for a well-formed response', () => {
    const raw = JSON.stringify({
      message: {
        id: 'm1',
        threadId: 't1',
        payload: { headers: [{ name: 'From', value: 'a@b.com' }] },
        extra: true,
      },
    });
    expect(
      parseJsonWith(MessageGetResponseSchema, raw, 'gog gmail get').message
        ?.payload?.headers,
    ).toEqual([{ name: 'From', value: 'a@b.com' }]);
  });

  it('rejects non-JSON output with a clear error', () => {
    expect(() =>
      parseJsonWith(LabelsListResponseSchema, 'oops', 'gog gmail search'),
    ).toThrow('gog gmail search: output is not JSON');
  });

  it('rejects malformed shapes instead of failing later', () => {
    expect(() =>
      parseJsonWith(
        ThreadGetResponseSchema,
        JSON.stringify({ thread: { messages: 'nope' } }),
        'gog gmail thread get',
      ),
    ).toThrow('gog gmail thread get: unexpected shape');
    expect(() =>
      parseJsonWith(
        MessageGetResponseSchema,
        JSON.stringify({ message: { payload: { headers: [{ name: 1 }] } } }),
        'gog gmail get',
      ),
    ).toThrow('unexpected shape');
    expect(() =>
      parseJsonWith(
        LabelsListResponseSchema,
        JSON.stringify({ labels: [{ id: 'x' }] }),
        'gog gmail labels list',
      ),
    ).toThrow('unexpected shape');
  });

  it('validates nested payload parts', () => {
    const bad = JSON.stringify({
      thread: { messages: [{ payload: { parts: [{ mimeType: 5 }] } }] },
    });
    expect(() =>
      parseJsonWith(ThreadGetResponseSchema, bad, 'gog gmail thread get'),
    ).toThrow('unexpected shape');
  });

  it('reads a header with no value (gog omits empty values) as empty', () => {
    const raw = JSON.stringify({
      thread: {
        messages: [
          {
            id: 'm1',
            payload: {
              headers: [
                { name: 'From', value: 'jane@example.com' },
                { name: 'X-GitHub-Labels' },
              ],
            },
          },
        ],
      },
    });
    expect(
      parseJsonWith(ThreadGetResponseSchema, raw, 'gog gmail thread get').thread
        ?.messages?.[0]?.payload?.headers,
    ).toEqual([
      { name: 'From', value: 'jane@example.com' },
      { name: 'X-GitHub-Labels', value: '' },
    ]);
  });
});
