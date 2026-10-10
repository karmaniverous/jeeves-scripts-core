/**
 * @module meetings/lib/extract-candidates
 *
 * Find meeting candidates in an account's email cache for
 * `meetings/extract`: scan `threads/` (and legacy per-message files),
 * keep messages that look like meetings (invites, Gemini notes, Fathom
 * links), and load an archived message by thread and message id.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readJson } from '@karmaniverous/jeeves';

import { getEmailBaseForAccount } from '../../config/index.js';
import { getThreadsPath } from '../../email/email-cache.js';
import { detectFathomFromBodies, isMeetingish } from './detect.js';

/** Check whether an archived message body contains a Fathom URL. */
function hasFathomUrlInBody(
  account: string,
  threadId: string,
  messageId: string,
): boolean {
  const archive = loadArchiveMessage(account, threadId, messageId);
  if (!archive) return false;
  return (
    detectFathomFromBodies(
      archive.body?.text ?? '',
      archive.body?.html ?? '',
    ) !== null
  );
}

interface CacheMessage {
  from?: string;
  snippet?: string;
  date?: string | null;
  internalDateMs?: number | null;
  labels?: string[];
}

interface CacheFile {
  threadId?: string;
  subject?: string;
  messages?: Record<string, CacheMessage>;
}

/** An archived message; only the body is read. */
export interface ArchiveMessage {
  body?: { text?: string; html?: string };
}

/** A cached message that looks like a meeting. */
export interface Candidate {
  account: string;
  threadId: string;
  messageId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string | null;
  internalDateMs: number | null;
  labels: string[];
}

/**
 * Meeting candidates in an account's cache: every message of every thread
 * in `threads/{account}/*\/thread.json`, then threads only in the legacy
 * `cache/{account}/*.json`.
 */
export function scanCache(account: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seenThreadIds = new Set<string>();

  // Prefer threads/{account}/ — each subdirectory contains a thread.json
  const threadsDir = path.join(
    getEmailBaseForAccount(account),
    'threads',
    account,
  );
  if (fs.existsSync(threadsDir)) {
    for (const entry of fs.readdirSync(threadsDir)) {
      const threadJsonPath = path.join(threadsDir, entry, 'thread.json');
      const cache = readJson<CacheFile | null>(threadJsonPath, null);
      if (!cache?.threadId) continue;
      seenThreadIds.add(cache.threadId);
      collectCandidates(candidates, account, cache);
    }
  }

  // Fall back to legacy cache/{account}/ for threads not yet in threads/
  const cacheDir = path.join(getEmailBaseForAccount(account), 'cache', account);
  if (fs.existsSync(cacheDir)) {
    for (const file of fs
      .readdirSync(cacheDir)
      .filter((f) => f.endsWith('.json'))) {
      const cache = readJson<CacheFile | null>(path.join(cacheDir, file), null);
      if (!cache?.threadId || seenThreadIds.has(cache.threadId)) continue;
      collectCandidates(candidates, account, cache);
    }
  }

  return candidates;
}

function collectCandidates(
  candidates: Candidate[],
  account: string,
  cache: CacheFile,
): void {
  const subject = cache.subject ?? '';
  const msgs = cache.messages ?? {};
  const msgIds = Object.keys(msgs);
  if (msgIds.length === 0) return;

  for (const [msgId, msg] of Object.entries(msgs)) {
    const from = msg.from ?? '';
    const snippet = msg.snippet ?? '';

    // Primary: subject/from/snippet heuristics
    // Fallback: Fathom URL in message body (spec section 5)
    if (
      isMeetingish(subject, from, snippet) ||
      hasFathomUrlInBody(account, cache.threadId!, msgId)
    ) {
      candidates.push({
        account,
        threadId: cache.threadId!,
        messageId: msgId,
        subject,
        from,
        snippet,
        date: msg.date ?? null,
        internalDateMs: msg.internalDateMs ?? null,
        labels: msg.labels ?? [],
      });
    }
  }
}

/**
 * An archived message: `threads/` first, then the legacy
 * `archive/{account}/{threadId}/` as `{messageId}.json` or `{threadId}.json`.
 */
export function loadArchiveMessage(
  account: string,
  threadId: string,
  messageId: string,
): ArchiveMessage | null {
  // Prefer threads/ path
  const threadsMsgPath = path.join(
    getThreadsPath(account, threadId),
    `${messageId}.json`,
  );
  if (fs.existsSync(threadsMsgPath)) {
    return readJson<ArchiveMessage | null>(threadsMsgPath, null);
  }

  // Fall back to legacy archive/ path
  const archiveBase = path.join(getEmailBaseForAccount(account), 'archive');
  const threadDir = path.join(archiveBase, account, threadId);
  if (!fs.existsSync(threadDir)) return null;

  const msgPath = path.join(threadDir, `${messageId}.json`);
  if (fs.existsSync(msgPath)) {
    return readJson<ArchiveMessage | null>(msgPath, null);
  }

  const threadPath = path.join(threadDir, `${threadId}.json`);
  if (fs.existsSync(threadPath)) {
    return readJson<ArchiveMessage | null>(threadPath, null);
  }

  return null;
}
