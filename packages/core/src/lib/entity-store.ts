/**
 * @module entity-store
 *
 * Shared entity persistence — upsert, backfill, and delete entity files
 * with reverse-diff history using fast-json-patch.
 *
 * Used by any domain that persists structured entities (Jira, Linear, etc.).
 * Callers supply the domain directory, entity type, key, and current
 * snapshot; this module handles file I/O and history management.
 */

import fs from 'node:fs';
import path from 'node:path';

import jsonpatch from 'fast-json-patch';

const compare = jsonpatch.compare.bind(jsonpatch);

export interface HistoryEntry {
  ts: string;
  patch: unknown[];
}

export interface EntityMeta {
  firstSeen: string;
  lastWebhook: string;
  lastBackfill: string | null;
  version: number;
}

export interface EntityFile {
  entityType: string;
  entityKey: string;
  current: Record<string, unknown>;
  history: HistoryEntry[];
  meta: EntityMeta;
}

/** Shape of entity files read from disk — all fields optional to handle partial/corrupt files. */
interface StoredEntity {
  current?: Record<string, unknown>;
  history?: HistoryEntry[];
  meta?: {
    firstSeen?: string;
    lastWebhook?: string;
    lastBackfill?: string | null;
    version?: number;
  };
}

/**
 * Upsert an entity file with reverse-diff history.
 *
 * If the file already exists, computes a reverse patch from the new
 * snapshot back to the old one and appends it to history. History is
 * capped at `maxHistory` entries (oldest dropped first).
 *
 * @returns Absolute path to the written file.
 */
export function upsertEntity(
  domainDir: string,
  type: string,
  key: string | number,
  current: Record<string, unknown>,
  now: string,
  maxHistory: number,
): string {
  const dir = path.join(domainDir, type);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${String(key)}.json`);

  let entity: EntityFile | null = null;

  if (fs.existsSync(filePath)) {
    try {
      const stored = JSON.parse(
        fs.readFileSync(filePath, 'utf8'),
      ) as StoredEntity;
      if (stored.current) {
        const reversePatch = compare(current, stored.current);
        const history = stored.history ?? [];
        if (reversePatch.length > 0) {
          history.push({
            ts: stored.meta?.lastWebhook ?? now,
            patch: reversePatch,
          });
          if (history.length > maxHistory) {
            history.splice(0, history.length - maxHistory);
          }
        }
        entity = {
          entityType: type,
          entityKey: String(key),
          current,
          history,
          meta: {
            firstSeen: stored.meta?.firstSeen ?? now,
            lastWebhook: now,
            lastBackfill: stored.meta?.lastBackfill ?? null,
            version: (stored.meta?.version ?? 0) + 1,
          },
        };
      }
    } catch {
      entity = null;
    }
  }

  if (!entity) {
    entity = {
      entityType: type,
      entityKey: String(key),
      current,
      history: [],
      meta: {
        firstSeen: now,
        lastWebhook: now,
        lastBackfill: null,
        version: 1,
      },
    };
  }

  fs.writeFileSync(filePath, JSON.stringify(entity, null, 2) + '\n', 'utf8');
  return filePath;
}

/**
 * Write a backfill entity file (does not overwrite existing files).
 *
 * @returns The file path if written, null if skipped (already exists).
 */
export function backfillEntity(
  domainDir: string,
  type: string,
  key: string | number,
  current: Record<string, unknown>,
  now: string,
): string | null {
  const dir = path.join(domainDir, type);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${String(key)}.json`);
  if (fs.existsSync(filePath)) return null;

  const entity: EntityFile = {
    entityType: type,
    entityKey: String(key),
    current,
    history: [],
    meta: {
      firstSeen: now,
      lastWebhook: now,
      lastBackfill: now,
      version: 1,
    },
  };

  fs.writeFileSync(filePath, JSON.stringify(entity, null, 2) + '\n', 'utf8');
  return filePath;
}

/**
 * Delete an entity file.
 *
 * @returns true if the file existed and was deleted, false otherwise.
 */
export function deleteEntity(
  domainDir: string,
  type: string,
  key: string | number,
): boolean {
  const filePath = path.join(domainDir, type, `${String(key)}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Write an unrecognised webhook payload to the `_unmatched/` subdirectory
 * of the given domain directory for later inspection.
 */
export function writeUnmatched(
  domainDir: string,
  label: string,
  body: unknown,
): void {
  const dir = path.join(domainDir, '_unmatched');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${String(Date.now())}-${label}.json`),
    JSON.stringify(body, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Read all of stdin and parse as JSON. Used by Event Gateway drain scripts
 * that receive webhook payloads piped from jeeves-server.
 */
export async function readStdinJson(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >;
}
