/**
 * @module slack/channel-meta/archive
 *
 * Read core's Slack message archive: one directory per channel,
 * `<root>/<name> (<id>)/`, one `<ts>.json` file per message (core's
 * `slack-poll`; the roots are every silo's `slack/` directory). Only
 * files newer than a ts are parsed, so a daily run reads a day's
 * messages, not a channel's history. Unreadable or invalid files are
 * skipped. File access is injected ({@link ArchiveFs}).
 */

import fs from 'node:fs';
import path from 'node:path';

import { type ChannelMessage, compareTs, messageSchema } from './messages.js';

/** The file access the job needs. */
export interface ArchiveFs {
  /** Entry names in a directory, `undefined` when it can't be read. */
  readdir: (dir: string) => string[] | undefined;
  /** A file's UTF-8 text, `undefined` when it can't be read. */
  readText: (file: string) => string | undefined;
  /** Whether a path exists. */
  exists: (p: string) => boolean;
}

/** {@link ArchiveFs} over `node:fs`. */
export const nodeArchiveFs: ArchiveFs = {
  readdir: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return undefined;
    }
  },
  readText: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  exists: (p) => fs.existsSync(p),
};

const CHANNEL_DIR = /\s\(([CGD][A-Z0-9]+)\)$/;
const MESSAGE_FILE = /^(\d+\.\d+)\.json$/;

/**
 * Map every archived channel id to its directory, across the roots (the
 * first root holding a channel wins).
 *
 * @param roots - Archive roots (`<silo>/slack`).
 * @param io - File access.
 * @returns Channel id to directory.
 */
export function indexArchive(
  roots: readonly string[],
  io: ArchiveFs,
): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const root of roots)
    for (const name of io.readdir(root) ?? []) {
      const id = CHANNEL_DIR.exec(name)?.[1];
      if (id !== undefined && !dirs.has(id))
        dirs.set(id, path.join(root, name));
    }
  return dirs;
}

/**
 * The archived messages of one channel newer than `since`, oldest first.
 *
 * @param dir - The channel's archive directory.
 * @param since - Exclusive lower bound; `undefined` reads every file.
 * @param io - File access.
 * @returns The messages.
 */
export function readArchivedSince(
  dir: string,
  since: string | undefined,
  io: ArchiveFs,
): ChannelMessage[] {
  const out: ChannelMessage[] = [];
  for (const name of io.readdir(dir) ?? []) {
    const ts = MESSAGE_FILE.exec(name)?.[1];
    if (ts === undefined) continue;
    if (since !== undefined && compareTs(ts, since) <= 0) continue;
    const text = io.readText(path.join(dir, name));
    if (text === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const parsed = messageSchema.safeParse(json);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => compareTs(a.ts, b.ts));
}
