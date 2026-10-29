/**
 * @module download-thread
 *
 * One queued thread's download for `email-download` (download.ts): fetch
 * the whole thread with `gog gmail thread` or each cached message with
 * `gog gmail get`, save each message record not yet on disk (records
 * built by message-record.ts), and give `thread.json` its messages map.
 * Side effects: gog calls and files under the account's threads directory.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ensureDir,
  getErrorMessage,
  readJson,
  writeJsonAtomic,
} from '@karmaniverous/jeeves';

import type { GogRunner } from '../../lib/gog.js';
import { getThreadsPath } from '../email-cache.js';
import { messageRecord, messageSummary } from './message-record.js';

const GOG_RETRY = { retries: 2, backoffMs: 5000 };

/** What a thread download calls. */
export interface ThreadIoDeps {
  /** gog. */
  gog: GogRunner;
  /** ISO timestamp. */
  now: () => string;
  /** Pause between gog calls (synchronous). */
  sleep: (ms: number) => void;
}

/** Run-wide message counts. */
export interface Tally {
  totalMsg: number;
  dlMsg: number;
  dlAtt: number;
  skipMsg: number;
  failMsg: number;
}

/** Per-thread download counts. */
export interface ThreadTally {
  downloaded: number;
  failed: number;
}

const messagePath = (account: string, threadId: string, messageId: string) =>
  path.join(getThreadsPath(account, threadId), `${messageId}.json`);

/** Save one message record; counts it as downloaded. */
function save(
  ids: { account: string; threadId: string; messageId: string },
  message: Record<string, unknown>,
  tally: Tally,
  thread: ThreadTally,
  now: string,
): void {
  const m = messageRecord(ids, message, now);
  const dir = getThreadsPath(ids.account, ids.threadId);
  ensureDir(dir);
  writeJsonAtomic(path.join(dir, `${ids.messageId}.json`), m.record);
  tally.dlMsg++;
  thread.downloaded++;
  tally.dlAtt += m.attachmentCount;
}

/**
 * Fetch a whole thread's messages; `string` (the failure reason, already
 * logged) when gog fails or returns nothing usable.
 */
export function fetchThread(
  account: string,
  threadId: string,
  deps: ThreadIoDeps,
): Record<string, unknown>[] | string {
  console.log(`Fetching full thread ${account}/${threadId}`);
  let raw: string | null;
  try {
    raw = deps.gog(
      ['gmail', 'thread', threadId, '--json', '--account', account],
      GOG_RETRY,
    );
  } catch (e) {
    console.error(
      `Failed to fetch thread ${account}/${threadId}: ${getErrorMessage(e)}`,
    );
    return getErrorMessage(e);
  }
  if (!raw) {
    console.error(`Null response fetching thread ${account}/${threadId}`);
    return 'gog thread returned null';
  }
  const data = JSON.parse(raw) as {
    thread?: { messages?: Record<string, unknown>[] };
  };
  const msgs = data.thread?.messages;
  if (!msgs || msgs.length === 0) {
    console.error(`No messages in thread response for ${account}/${threadId}`);
    return 'thread response had no messages';
  }
  deps.sleep(200);
  return msgs;
}

/** Save the messages of a fetched thread and give thread.json its messages map. */
export function saveThread(
  account: string,
  threadId: string,
  messages: Record<string, unknown>[],
  tally: Tally,
  deps: ThreadIoDeps,
): ThreadTally {
  const thread: ThreadTally = { downloaded: 0, failed: 0 };
  const messagesMap: Record<string, ReturnType<typeof messageSummary>> = {};
  for (const message of messages) {
    const messageId = message.id as string;
    tally.totalMsg++;
    if (fs.existsSync(messagePath(account, threadId, messageId))) {
      // Still record in map for thread.json update
      messagesMap[messageId] = messageSummary(messageId, message);
      tally.skipMsg++;
      continue;
    }
    try {
      console.log(`Downloading ${account}/${threadId}/${messageId}`);
      save(
        { account, threadId, messageId },
        message,
        tally,
        thread,
        deps.now(),
      );
      messagesMap[messageId] = messageSummary(messageId, message);
    } catch (e) {
      console.error(`Failed ${messageId}:`, getErrorMessage(e));
      tally.failMsg++;
      thread.failed++;
    }
  }
  // Update thread.json with messages map so future runs skip the full-thread fetch
  if (Object.keys(messagesMap).length > 0) {
    const threadsDir = getThreadsPath(account, threadId);
    ensureDir(threadsDir);
    const threadFile = path.join(threadsDir, 'thread.json');
    const existing =
      readJson<Record<string, unknown> | null>(threadFile, null) ?? {};
    writeJsonAtomic(threadFile, { ...existing, messages: messagesMap });
  }
  return thread;
}

/** Download each cached message id not yet on disk. */
export function downloadByIds(
  account: string,
  threadId: string,
  messageIds: string[],
  tally: Tally,
  deps: ThreadIoDeps,
): ThreadTally {
  const thread: ThreadTally = { downloaded: 0, failed: 0 };
  for (const messageId of messageIds) {
    tally.totalMsg++;
    if (fs.existsSync(messagePath(account, threadId, messageId))) {
      tally.skipMsg++;
      continue;
    }
    try {
      console.log(`Downloading ${account}/${threadId}/${messageId}`);
      const raw = deps.gog(
        ['gmail', 'get', messageId, '--json', '--account', account],
        GOG_RETRY,
      );
      if (!raw) {
        tally.failMsg++;
        thread.failed++;
        continue;
      }
      const payload = JSON.parse(raw) as { message?: Record<string, unknown> };
      save(
        { account, threadId, messageId },
        payload.message ?? payload,
        tally,
        thread,
        deps.now(),
      );
      deps.sleep(100);
    } catch (e) {
      console.error(`Failed ${messageId}:`, getErrorMessage(e));
      tally.failMsg++;
      thread.failed++;
    }
  }
  return thread;
}
