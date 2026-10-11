/**
 * @module email/imap/message-store
 *
 * Write a normalised IMAP message into the email cache: the per-message
 * JSON under `threads/{account}/{threadId}/` and the thread's cache
 * entry. Existing messages are detected so they are not rewritten.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, nowIso, writeJsonAtomic } from '@karmaniverous/jeeves';

import { emailPeopleFields } from '../../lib/people.js';
import { createOrUpdateCache, getThreadsPath } from '../email-cache.js';
import { type NormalizedMessage } from './normalize.js';

// ── Disk writes ───────────────────────────────────────────────────────

/** Whether the message's JSON is already in the thread's directory. */
export function messageExists(
  account: string,
  threadId: string,
  msgId: string,
): boolean {
  return fs.existsSync(
    path.join(getThreadsPath(account, threadId), `${msgId}.json`),
  );
}

/** Write thread cache + per-message JSON from a NormalizedMessage. */
export function writeMessage(
  account: string,
  threadId: string,
  messageId: string,
  msg: NormalizedMessage,
  labels: string[],
): void {
  const dir = getThreadsPath(account, threadId);
  ensureDir(dir);

  createOrUpdateCache({
    account,
    threadId,
    subject: msg.headers.subject,
    participants: [
      ...new Set(
        [msg.headers.from, msg.headers.to, msg.headers.cc].filter(Boolean),
      ),
    ],
    messages: {
      [messageId]: {
        messageId,
        from: msg.headers.from,
        to: msg.headers.to,
        cc: msg.headers.cc,
        date: msg.headers.date || null,
        internalDateMs: msg.internalDate.getTime(),
        labels,
        snippet: msg.computed.snippet,
        hasAttachments: msg.attachments.length > 0,
        attachments: msg.attachments,
      },
    },
    provenance: [],
  });

  writeJsonAtomic(path.join(dir, `${messageId}.json`), {
    messageId,
    threadId,
    account,
    subject: msg.headers.subject,
    from: msg.headers.from,
    to: msg.headers.to,
    cc: msg.headers.cc,
    ...emailPeopleFields(msg.headers),
    date: msg.headers.date || null,
    internalDateMs: msg.internalDate.getTime(),
    labels,
    body: msg.body,
    attachments: msg.attachments,
    downloadedAt: nowIso(),
  });
}
