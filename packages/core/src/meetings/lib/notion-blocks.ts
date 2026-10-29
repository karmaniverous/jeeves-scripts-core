/**
 * @module notion-blocks
 *
 * Notion block building for the Inbox processor (notion-inbox-processor):
 * paragraph and heading blocks, text chunked to the API's rich-text size,
 * and appending blocks to a page in batches. Side effects: only through
 * the injected Notion request.
 */

/** A Notion REST call: method, API path, JSON body. */
export type NotionRequest = (
  method: string,
  path: string,
  body: unknown,
) => Promise<unknown>;

/** Split text into chunks of at most `max` characters (Notion rich-text limit). */
export function chunkText(s: string, max = 1200): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + max));
    i += max;
  }
  return out;
}

/** A Notion block object, as the blocks API takes it. */
export interface NotionBlock {
  object: string;
  type: string;
  [key: string]: unknown;
}

/** A paragraph block holding `text`. */
export function paragraphBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

/** A heading block (level 2 by default) holding `text`. */
export function headingBlock(text: string, level: 1 | 2 | 3 = 2): NotionBlock {
  const type =
    level === 1 ? 'heading_1' : level === 3 ? 'heading_3' : 'heading_2';
  return {
    object: 'block',
    type,
    [type]: { rich_text: [{ type: 'text', text: { content: text } }] },
  };
}

/** Append blocks under `blockId`, 50 per request (the API's limit). */
export async function appendBlocks(
  blockId: string,
  blocks: NotionBlock[],
  request: NotionRequest,
): Promise<void> {
  const batchSize = 50;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const slice = blocks.slice(i, i + batchSize);
    await request('PATCH', `/v1/blocks/${blockId}/children`, {
      children: slice,
    });
  }
}
