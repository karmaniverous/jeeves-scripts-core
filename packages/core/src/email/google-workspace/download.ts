/**
 * @module download
 *
 * Dequeue threads from `email-pending` and download full message bodies
 * from Gmail, saving each message as JSON in the thread cache directory.
 *
 * Scheduled runner job. For each queued thread, fetches messages via
 * `gog gmail thread` (a thread with no cached messages map) or
 * `gog gmail get` (one call per cached message id), and writes per-message
 * JSON files under the account's threads directory (records built by
 * message-record.ts). Logs run stats to `EMAIL_EVENTS_DIR`.
 *
 * Skips when no gog accounts are configured (getGmailAccounts(): polled
 * Gmail accounts plus emailConfig.backfill.accounts); fails when there are
 * some but gog has no OAuth client and no service-account mailboxes.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  appendJsonl,
  ensureDir,
  nowIso,
  readJson,
  sleepMs,
  writeJsonAtomic,
} from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { getGmailAccounts } from '../../config/index.js';
import { defineJob } from '../../jobs/define-job.js';
import { constants } from '../../lib/constants.js';
import { type GogRunner, gogWithRetry } from '../../lib/gog.js';
import { requireGogCredentials } from '../../lib/gog-credentials.js';
import { getThreadsPath } from '../email-cache.js';
import { messageRecord, messageSummary } from './message-record.js';

/** Threads taken from the queue per run. */
export const DOWNLOAD_BATCH = 50;
const GOG_RETRY = { retries: 2, backoffMs: 5000 };

/** What {@link downloadThreads} reads and calls. */
export interface DownloadDeps {
  /** Whether gog can run for the configured Gmail accounts (throws when they exist without a credential). */
  hasGmail: () => boolean;
  /** gog. */
  gog: GogRunner;
  /** Runner queue. */
  runner: () => Pick<RunnerClient, 'dequeue' | 'done' | 'fail' | 'close'>;
  /** `EMAIL_EVENTS_DIR`. */
  eventsDir: string;
  /** ISO timestamp. */
  now: () => string;
  /** Pause between gog calls (synchronous). */
  sleep: (ms: number) => void;
}

/** The live collaborators, from config. */
export const downloadDeps = (): DownloadDeps => ({
  hasGmail: () =>
    requireGogCredentials('email/download', getGmailAccounts().length),
  gog: gogWithRetry,
  runner: () => getRunnerClient(),
  eventsDir: constants().EMAIL_EVENTS_DIR,
  now: nowIso,
  sleep: sleepMs,
});

interface Tally {
  totalMsg: number;
  dlMsg: number;
  dlAtt: number;
  skipMsg: number;
  failMsg: number;
}

/** Per-thread download counts. */
interface ThreadTally {
  downloaded: number;
  failed: number;
}

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

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
function fetchThread(
  account: string,
  threadId: string,
  deps: DownloadDeps,
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
      `Failed to fetch thread ${account}/${threadId}: ${errText(e)}`,
    );
    return errText(e);
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
function saveThread(
  account: string,
  threadId: string,
  messages: Record<string, unknown>[],
  tally: Tally,
  deps: DownloadDeps,
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
      console.error(`Failed ${messageId}:`, errText(e));
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
function downloadByIds(
  account: string,
  threadId: string,
  messageIds: string[],
  tally: Tally,
  deps: DownloadDeps,
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
      console.error(`Failed ${messageId}:`, errText(e));
      tally.failMsg++;
      thread.failed++;
    }
  }
  return thread;
}

/** Download the next batch of queued threads and log the run's stats. */
export function downloadThreads(deps: DownloadDeps): void {
  if (!deps.hasGmail()) {
    console.log('[skip] No Gmail accounts configured');
    return;
  }
  const client = deps.runner();
  try {
    const items = client.dequeue('email-pending', DOWNLOAD_BATCH);
    const tally: Tally = {
      totalMsg: 0,
      dlMsg: 0,
      dlAtt: 0,
      skipMsg: 0,
      failMsg: 0,
    };
    let procTh = 0,
      failTh = 0;
    console.log(`Dequeued ${String(items.length)} threads for download`);

    for (const { id: qId, payload } of items) {
      const { account, threadId } = payload as {
        account: string;
        threadId: string;
      };
      try {
        const cache = readJson<{ messages?: Record<string, unknown> } | null>(
          path.join(getThreadsPath(account, threadId), 'thread.json'),
          null,
        );
        let thread: ThreadTally;
        if (cache?.messages) {
          thread = downloadByIds(
            account,
            threadId,
            Object.keys(cache.messages),
            tally,
            deps,
          );
        } else {
          // Old thread with no messages map: fetch the full thread.
          const fetched = fetchThread(account, threadId, deps);
          if (typeof fetched === 'string') {
            client.fail(qId, fetched);
            failTh++;
            continue;
          }
          thread = saveThread(account, threadId, fetched, tally, deps);
        }
        if (thread.downloaded > 0 || thread.failed === 0) {
          client.done(qId);
          procTh++;
        } else {
          client.fail(
            qId,
            `Failed to download any messages (${String(thread.failed)} failed)`,
          );
          failTh++;
        }
      } catch (e) {
        console.error(`Failed thread ${threadId}:`, errText(e));
        client.fail(qId, errText(e));
        failTh++;
      }
    }

    const stats = {
      at: deps.now(),
      kind: 'download',
      threadsDequeued: items.length,
      processedThreads: procTh,
      failedThreads: failTh,
      totalMessages: tally.totalMsg,
      downloadedMessages: tally.dlMsg,
      downloadedAttachments: tally.dlAtt,
      skippedMessages: tally.skipMsg,
      failedMessages: tally.failMsg,
    };
    ensureDir(deps.eventsDir);
    appendJsonl(path.join(deps.eventsDir, '_runs-download.jsonl'), stats);
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    client.close();
  }
}

export default defineJob({
  id: 'email-download',
  domain: 'email',
  name: 'email/download',
  crashDir: () => constants().EMAIL_EVENTS_DIR,
  run: () => {
    downloadThreads(downloadDeps());
  },
});
