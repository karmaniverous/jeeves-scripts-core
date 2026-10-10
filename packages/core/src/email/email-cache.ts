/**
 * @module email-cache
 *
 * Load, save, and update per-thread JSON caches that store message
 * metadata, labels, and provenance history.
 *
 * Used by poll, download, drain-updates, and email-fetch to persist
 * thread state on disk under each account's silo. Each thread gets a
 * directory with a `thread.json` file containing the ThreadCache.
 *
 * Paths are resolved via silo-router's getEmailBaseForAccount. If the
 * silo path is misconfigured, all cache operations will fail.
 */

import path from 'node:path';

import {
  ensureDir,
  nowIso,
  readJson,
  writeJsonAtomic,
} from '@karmaniverous/jeeves';

import { getEmailBaseForAccount } from '../config/index.js';

export interface CacheMessage {
  messageId: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  internalDateMs: number | null;
  labels: string[];
  snippet: string;
  hasAttachments: boolean;
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
  }[];
}

export interface ProvenanceEntry {
  field: string;
  messageId: string;
  value: string;
  by: string;
  source?: string;
  at: string;
}

export interface ThreadCache {
  threadId: string;
  account: string;
  subject: string;
  participants: string[];
  messages?: Record<string, CacheMessage>;
  provenance: ProvenanceEntry[];
  cachedAt: string;
  updatedAt: string;
}

/** Return the filesystem path to a thread's cache directory. */
export function getThreadsPath(account: string, threadId: string): string {
  const emailBase = getEmailBaseForAccount(account);
  return path.join(emailBase, 'threads', account, threadId);
}

/** Load a thread's cached metadata from disk, or null if not found. */
export function loadCache(
  account: string,
  threadId: string,
): ThreadCache | null {
  const threadsFile = path.join(
    getThreadsPath(account, threadId),
    'thread.json',
  );
  return readJson<ThreadCache | null>(threadsFile, null);
}

/** Persist a ThreadCache to disk, updating the updatedAt timestamp. */
export function saveCache(cache: ThreadCache): void {
  cache.updatedAt = nowIso();

  const threadsDir = getThreadsPath(cache.account, cache.threadId);
  ensureDir(threadsDir);
  writeJsonAtomic(path.join(threadsDir, 'thread.json'), cache);
}

/** Create a new thread cache or merge messages/provenance into an existing one. */
export function createOrUpdateCache(params: {
  account: string;
  threadId: string;
  subject: string;
  participants: string[];
  messages: Record<string, CacheMessage>;
  provenance: ProvenanceEntry[];
}): ThreadCache {
  let cache = loadCache(params.account, params.threadId);
  const now = nowIso();

  cache ??= {
    threadId: params.threadId,
    account: params.account,
    subject: params.subject,
    participants: params.participants,
    messages: {},
    provenance: [],
    cachedAt: now,
    updatedAt: now,
  };

  cache.subject = params.subject;
  cache.participants = params.participants;

  cache.messages ??= {};
  for (const [messageId, msgData] of Object.entries(params.messages)) {
    const existing = cache.messages[messageId];
    cache.messages[messageId] = { ...existing, ...msgData };
  }

  cache.provenance.push(...params.provenance);

  saveCache(cache);
  return cache;
}

/** Compare cached vs current labels and return provenance entries for changes. */
export function detectLabelChanges(
  cached: string[] | undefined,
  current: string[] | undefined,
  messageId: string,
): ProvenanceEntry[] {
  const changes: ProvenanceEntry[] = [];
  const cachedSet = new Set(cached ?? []);
  const currentSet = new Set(current ?? []);

  for (const label of currentSet) {
    if (!cachedSet.has(label)) {
      changes.push({
        field: 'labels',
        messageId,
        value: `+${label}`,
        by: 'human',
        at: nowIso(),
      });
    }
  }

  for (const label of cachedSet) {
    if (!currentSet.has(label)) {
      changes.push({
        field: 'labels',
        messageId,
        value: `-${label}`,
        by: 'human',
        at: nowIso(),
      });
    }
  }

  return changes;
}
