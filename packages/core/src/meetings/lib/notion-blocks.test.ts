import { describe, expect, it, vi } from 'vitest';

import {
  appendBlocks,
  chunkText,
  headingBlock,
  paragraphBlock,
} from './notion-blocks.js';

const richText = (content: string) => ({
  rich_text: [{ type: 'text', text: { content } }],
});

describe('paragraphBlock / headingBlock', () => {
  it('builds a paragraph block', () => {
    expect(paragraphBlock('hi')).toEqual({
      object: 'block',
      type: 'paragraph',
      paragraph: richText('hi'),
    });
  });

  it('builds headings at levels 1, 2 (the default) and 3', () => {
    expect(headingBlock('a', 1)).toEqual({
      object: 'block',
      type: 'heading_1',
      heading_1: richText('a'),
    });
    expect(headingBlock('b')).toMatchObject({ type: 'heading_2' });
    expect(headingBlock('c', 3)).toMatchObject({
      type: 'heading_3',
      heading_3: richText('c'),
    });
  });
});

describe('appendBlocks', () => {
  it('appends in batches of 50 under the block', async () => {
    const request = vi.fn(() => Promise.resolve({}));
    const blocks = Array.from({ length: 120 }, (_, i) =>
      paragraphBlock(String(i)),
    );
    await appendBlocks('page-1', blocks, request);
    expect(
      request.mock.calls.map(([m, p, body]) => [
        m,
        p,
        (body as { children: unknown[] }).children.length,
      ]),
    ).toEqual([
      ['PATCH', '/v1/blocks/page-1/children', 50],
      ['PATCH', '/v1/blocks/page-1/children', 50],
      ['PATCH', '/v1/blocks/page-1/children', 20],
    ]);
  });

  it('makes no request for no blocks', async () => {
    const request = vi.fn(() => Promise.resolve({}));
    await appendBlocks('page-1', [], request);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    expect(chunkText('hello', 100)).toEqual(['hello']);
  });

  it('splits long text into chunks', () => {
    const text = 'a'.repeat(300);
    const chunks = chunkText(text, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length === 100)).toBe(true);
  });

  it('handles empty string', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('uses default max of 1200', () => {
    const text = 'x'.repeat(2500);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1200);
    expect(chunks[1]).toHaveLength(1200);
    expect(chunks[2]).toHaveLength(100);
  });
});
