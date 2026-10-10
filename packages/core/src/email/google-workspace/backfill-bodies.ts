#!/usr/bin/env tsx
/**
 * @module backfill-bodies
 *
 * One-shot backfill: find cached threads missing downloaded message
 * bodies and enqueue them to `email-pending` for download.
 *
 * Run manually as an entry-point script. Walks each account's threads
 * directory looking for thread dirs that have thread.json but no
 * per-message JSON files, then enqueues them for the download script.
 * Supports --live flag; defaults to dry-run.
 *
 * Depends on silo-router for per-account thread paths and
 * the `pipeline` config for the account list.
 */

import fs from 'node:fs';
import path from 'node:path';

import { nowIso, readJson, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getEmailAccounts } from '../../config/index.js';
import { getEmailBaseForAccount } from '../../config/index.js';

interface ThreadCache {
  threadId: string;
  account: string;
  subject: string;
  messages?: Record<string, unknown>;
}

function main(): void {
  const live = process.argv.includes('--live');
  console.log(`Mode: ${live ? 'LIVE' : 'DRY-RUN'}\n`);

  const accounts = getEmailAccounts();

  const client = getRunnerClient();

  let grandChecked = 0;
  let grandNeedBackfill = 0;
  let grandEnqueued = 0;

  try {
    for (const account of accounts) {
      const emailBase = getEmailBaseForAccount(account);
      const threadsDir = path.join(emailBase, 'threads', account);

      if (!fs.existsSync(threadsDir)) {
        console.log(`[${account}] threads dir not found, skipping`);
        continue;
      }

      let checked = 0;
      let needBackfill = 0;
      let enqueued = 0;

      for (const entry of fs.readdirSync(threadsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const threadDir = path.join(threadsDir, entry.name);
        const threadJsonPath = path.join(threadDir, 'thread.json');

        if (!fs.existsSync(threadJsonPath)) continue;
        checked++;

        // Check for any .json file that is NOT thread.json (i.e. a message body)
        const files = fs.readdirSync(threadDir);
        const hasBody = files.some(
          (f) => f.endsWith('.json') && f !== 'thread.json',
        );

        if (hasBody) continue;
        needBackfill++;

        const thread = readJson<ThreadCache | null>(threadJsonPath, null);
        if (!thread) {
          console.log(`  [WARN] could not read ${threadJsonPath}`);
          continue;
        }

        const messageCount = Object.keys(thread.messages ?? {}).length;

        if (live) {
          client.enqueue('email-pending', {
            account,
            threadId: entry.name,
            subject: thread.subject,
            newMessages: messageCount,
            createdAt: nowIso(),
          });
          enqueued++;
        } else {
          console.log(
            `  would enqueue ${entry.name} (${String(messageCount)} msgs): ${thread.subject}`,
          );
          enqueued++;
        }
      }

      console.log(
        `[${account}] checked=${String(checked)} needBackfill=${String(needBackfill)} enqueued=${String(enqueued)}`,
      );

      grandChecked += checked;
      grandNeedBackfill += needBackfill;
      grandEnqueued += enqueued;
    }
  } finally {
    client.close();
  }

  console.log(
    `\nTOTAL: checked=${String(grandChecked)} needBackfill=${String(grandNeedBackfill)} enqueued=${String(grandEnqueued)}`,
  );
}

runScript('email/backfill-bodies', main);
