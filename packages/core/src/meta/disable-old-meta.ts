/**
 * @module disable-old-meta
 *
 * Disable stale meta entries for time-bounded entity types.
 *
 * Loops over ENTITY_TYPES (fixed in lib/constants), resolves root directories
 * via silo-router, and scans each entity's .meta/meta.json. If the
 * entity date exceeds the type's maxAgeDays threshold and _content
 * already exists (synthesis complete), writes _disabled: true to
 * prevent further synthesis scheduling.
 *
 * Entity types with maxAgeDays: null are skipped entirely.
 */

import fs from 'node:fs';
import path from 'node:path';

import { getEntityDirs } from '../config/index.js';
import { defineJob } from '../jobs/define-job.js';
import { ENTITY_TYPES, type EntityTypeConfig } from '../lib/constants.js';

/** Extract a parseable date from meta fields or _content header. */
function getEntityDate(meta: Record<string, unknown>): Date | null {
  // Try structured date fields first
  const dateStr =
    (meta.meetingDate as string) ||
    (meta.date as string) ||
    (meta.meeting_date as string);

  if (dateStr && typeof dateStr === 'string') {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }

  // Fall back to parsing from _content header (e.g. "2026-03-11" in first 200 chars)
  const content = meta._content as string;
  if (content && typeof content === 'string') {
    const header = content.slice(0, 200);
    const isoMatch = /(\d{4}-\d{2}-\d{2})/.exec(header);
    if (isoMatch) {
      const d = new Date(isoMatch[1] ?? '');
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
}

/** What {@link disableOldMeta} reads. */
export interface DisableOldMetaDeps {
  /** Entity types with their age limits. */
  entityTypes: readonly EntityTypeConfig[];
  /** The entity root directories of a type (through the silos). */
  entityDirs: (subdir: string) => string[];
  /** Clock (ms). */
  now: () => number;
}

/** Disable every synthesised meta older than its type's limit; one JSON summary line per type. */
export function disableOldMeta(deps: DisableOldMetaDeps): void {
  for (const entityType of deps.entityTypes) {
    if (entityType.maxAgeDays == null) continue;

    const cutoff = new Date(
      deps.now() - entityType.maxAgeDays * 24 * 60 * 60 * 1000,
    );
    let scanned = 0;
    let disabled = 0;
    let alreadyDisabled = 0;
    let skippedNoContent = 0;
    let skippedNoDate = 0;
    let skippedRecent = 0;

    const entityRoots = deps.entityDirs(entityType.subdir);

    for (const root of entityRoots) {
      if (!fs.existsSync(root)) continue;

      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === '.meta') continue;

        const metaPath = path.join(root, entry.name, '.meta', 'meta.json');
        if (!fs.existsSync(metaPath)) continue;

        scanned++;

        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
            _disabled?: boolean;
            _content?: string;
            [key: string]: unknown;
          };

          if (meta._disabled === true) {
            alreadyDisabled++;
            continue;
          }

          if (!meta._content) {
            skippedNoContent++;
            continue;
          }

          const entityDate = getEntityDate(meta);
          if (!entityDate) {
            skippedNoDate++;
            continue;
          }

          if (entityDate > cutoff) {
            skippedRecent++;
            continue;
          }

          meta._disabled = true;
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
          disabled++;
        } catch {
          // Skip malformed meta files
        }
      }
    }

    console.log(
      JSON.stringify({
        entityType: entityType.subdir,
        maxAgeDays: entityType.maxAgeDays,
        scanned,
        disabled,
        alreadyDisabled,
        skippedNoContent,
        skippedNoDate,
        skippedRecent,
        cutoffDate: cutoff.toISOString().slice(0, 10),
      }),
    );
  }
}

export default defineJob({
  id: 'meta-disable-old',
  domain: 'meta',
  name: 'meta/disable-old-meta',
  run: () => {
    disableOldMeta({
      entityTypes: ENTITY_TYPES,
      entityDirs: getEntityDirs,
      now: Date.now,
    });
  },
});
