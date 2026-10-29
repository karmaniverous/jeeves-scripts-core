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

import path from 'node:path';

import {
  appendJsonl,
  ensureDir,
  nowIso,
  readJson,
  sleepMs,
} from '@karmaniverous/jeeves';
import {
  getRunnerClient,
  type RunnerClient,
} from '@karmaniverous/jeeves-runner';

import { getGmailAccounts } from '../../config/index.js';
import { constants } from '../../lib/constants.js';
import { gogWithRetry } from '../../lib/gog.js';
import { requireGogCredentials } from '../../lib/gog-credentials.js';
import { defineRunnable } from '../../runnables/define-runnable.js';
import { getThreadsPath } from '../email-cache.js';
import {
  downloadByIds,
  errText,
  fetchThread,
  saveThread,
  type Tally,
  type ThreadIoDeps,
  type ThreadTally,
} from './download-thread.js';

/** Threads taken from the queue per run. */
export const DOWNLOAD_BATCH = 50;

/** What {@link downloadThreads} reads and calls. */
export interface DownloadDeps extends ThreadIoDeps {
  /** Whether gog can run for the configured Gmail accounts (throws when they exist without a credential). */
  hasGmail: () => boolean;
  /** Runner queue. */
  runner: () => Pick<RunnerClient, 'dequeue' | 'done' | 'fail' | 'close'>;
  /** `EMAIL_EVENTS_DIR`. */
  eventsDir: string;
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

export default defineRunnable({
  id: 'email-download',
  domain: 'email',
  flags: {},
  name: 'email/download',
  crashDir: () => constants().EMAIL_EVENTS_DIR,
  run: () => {
    downloadThreads(downloadDeps());
  },
});
