/**
 * @module slack/channel-meta/meta
 *
 * A home directory's seeded jeeves-meta entity, `<homeDir>/.meta/meta.json`:
 * the fields the descriptions and topics come from (`_steer`, `_content`)
 * and `_generatedAt`, which tells the job a value it set is stale. A meta
 * that is missing or not JSON counts as not seeded. File access is
 * injected.
 */

import path from 'node:path';

import { z } from 'zod';

/** Longest `_content` excerpt handed to the worker. */
export const META_CONTENT_MAX = 6000;

/** The parts of a meta the job reads. */
export interface ChannelMetaEntity {
  /** The meta file. */
  file: string;
  /** `_generatedAt`, if synthesized. */
  generatedAt?: string;
  /** `_steer`, if set. */
  steer?: string;
  /** `_content`, cut to {@link META_CONTENT_MAX} characters. */
  content?: string;
}

const metaSchema = z
  .object({
    _generatedAt: z.string().optional(),
    _steer: z.string().optional(),
    _content: z.string().optional(),
  })
  .loose();

/** A home directory's meta file. */
export const metaFile = (homeDir: string): string =>
  path.join(homeDir, '.meta', 'meta.json');

/**
 * Read a home directory's meta.
 *
 * @param homeDir - The home directory.
 * @param readText - File reader (`undefined` when missing).
 * @returns The meta, or `undefined` when it is not seeded.
 */
export function readMeta(
  homeDir: string,
  readText: (file: string) => string | undefined,
): ChannelMetaEntity | undefined {
  const file = metaFile(homeDir);
  const text = readText(file);
  if (text === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = metaSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const { _generatedAt, _steer, _content } = parsed.data;
  return {
    file,
    ...(_generatedAt === undefined ? {} : { generatedAt: _generatedAt }),
    ...(_steer?.trim() ? { steer: _steer } : {}),
    ...(_content?.trim()
      ? { content: _content.slice(0, META_CONTENT_MAX) }
      : {}),
  };
}
