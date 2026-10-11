#!/usr/bin/env tsx
/**
 * @module sweep-duplicates
 *
 * Generalized duplicate and rejection sweep for all entity types.
 *
 * Loops over ENTITY_TYPES from constants.ts, resolves root directories
 * via silo-router, then scans each entity directory's .meta/meta.json
 * for two cases:
 *   1. Rejection — a type-specific rejection key is true (e.g. nonMeeting
 *      for meetings) → delete the entity directory entirely.
 *   2. Duplicate — duplicateOf has a non-null value → merge files into the
 *      original directory, then delete the duplicate.
 *
 * Uses copy + delete (not move) because watcher holds file locks.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readJson, runScript } from '@karmaniverous/jeeves';

import { getEntityDirs } from '../config/index.js';
import { ENTITY_TYPES } from '../lib/constants.js';

/** All case variants of "duplicateOf" that builders might emit. */
const DUPLICATE_KEY_VARIANTS = new Set(['duplicateof', 'duplicate_of']);

interface DuplicateMatch {
  key: string;
  value: string;
}

/** Find any duplicateOf-variant key with a truthy string value. */
function findDuplicateKey(
  meta: Record<string, unknown>,
): DuplicateMatch | null {
  for (const key of Object.keys(meta)) {
    if (!DUPLICATE_KEY_VARIANTS.has(key.toLowerCase())) continue;
    const value = meta[key];
    if (typeof value === 'string' && value.length > 0) {
      return { key, value };
    }
  }
  return null;
}

/** Check if any rejection-variant key is truthy. */
function isRejected(
  meta: Record<string, unknown>,
  rejectionKeys: Set<string>,
): boolean {
  for (const key of Object.keys(meta)) {
    if (!rejectionKeys.has(key.toLowerCase())) continue;
    if (meta[key] === true) return true;
  }
  return false;
}

/**
 * Resolve a duplicateOf value to an absolute directory path.
 * Handles bare hex IDs (sibling lookup) and full/partial paths.
 */
function resolveOriginalPath(
  duplicateDir: string,
  rawValue: string,
): string | null {
  if (rawValue.includes('/') || rawValue.includes('\\')) {
    const resolved = path.resolve(rawValue);
    return fs.existsSync(resolved) ? resolved : null;
  }

  const parent = path.dirname(duplicateDir);
  const resolved = path.join(parent, rawValue);
  return fs.existsSync(resolved) ? resolved : null;
}

/** Recursively list all files under a directory, skipping .meta/. */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.meta') results.push(...collectFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function main(): void {
  let totalRejected = 0;
  let totalDuplicates = 0;
  let totalMerged = 0;
  let totalDeleted = 0;
  let totalFilesCopied = 0;
  const errors: string[] = [];

  for (const entityType of ENTITY_TYPES) {
    const rejectionKeys = new Set(entityType.rejectionKeys);
    const entityRoots = getEntityDirs(entityType.subdir);

    console.log(`\n=== Entity type: ${entityType.subdir} ===`);

    for (const root of entityRoots) {
      if (!fs.existsSync(root)) {
        console.log(`[skip] Root does not exist: ${root}`);
        continue;
      }

      const entityDirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(root, e.name));

      for (const entityDir of entityDirs) {
        const metaJsonPath = path.join(entityDir, '.meta', 'meta.json');
        const meta = readJson<Record<string, unknown> | null>(
          metaJsonPath,
          null,
        );
        if (!meta) continue;

        // Rejection: delete entirely
        if (isRejected(meta, rejectionKeys)) {
          totalRejected++;
          console.log(`\n[rejected] ${entityDir}`);

          try {
            fs.rmSync(entityDir, { recursive: true, force: true });
            console.log(`  [deleted] ${entityDir}`);
            totalDeleted++;
          } catch (e) {
            const msg = `  [error] Failed to delete ${entityDir}: ${(e as Error).message}`;
            console.log(msg);
            errors.push(msg);
          }

          continue;
        }

        // Duplicate: merge into original, then delete
        const dup = findDuplicateKey(meta);
        if (!dup) continue;

        totalDuplicates++;

        const originalPath = resolveOriginalPath(entityDir, dup.value);
        if (!originalPath) {
          const msg = `[error] Cannot resolve original for ${entityDir} → ${dup.value}`;
          console.log(msg);
          errors.push(msg);
          continue;
        }

        if (path.resolve(entityDir) === path.resolve(originalPath)) {
          console.log(`[skip] Self-reference: ${entityDir}`);
          continue;
        }

        console.log(`\n[duplicate] ${entityDir}`);
        console.log(`  → original: ${originalPath}`);
        console.log(`  → key: ${dup.key}, value: ${dup.value}`);

        // Copy unique files from duplicate to original
        const dupFiles = collectFiles(entityDir);
        let copied = 0;

        for (const srcFile of dupFiles) {
          const relPath = path.relative(entityDir, srcFile);
          const destFile = path.join(originalPath, relPath);

          if (fs.existsSync(destFile)) {
            console.log(`  [skip] already exists: ${relPath}`);
            continue;
          }

          const destDir = path.dirname(destFile);
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(srcFile, destFile);
          console.log(`  [copied] ${relPath}`);
          copied++;
        }

        totalFilesCopied += copied;

        // Delete the duplicate directory
        try {
          fs.rmSync(entityDir, { recursive: true, force: true });
          console.log(`  [deleted] ${entityDir}`);
          totalDeleted++;
        } catch (e) {
          const msg = `  [error] Failed to delete ${entityDir}: ${(e as Error).message}`;
          console.log(msg);
          errors.push(msg);
        }

        totalMerged++;
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Rejected entities removed: ${String(totalRejected)}`);
  console.log(`Duplicates found: ${String(totalDuplicates)}`);
  console.log(`Merged: ${String(totalMerged)}`);
  console.log(`Files copied: ${String(totalFilesCopied)}`);
  console.log(`Directories deleted: ${String(totalDeleted)}`);
  if (errors.length > 0) {
    console.log(`Errors: ${String(errors.length)}`);
    for (const e of errors) console.log(`  ${e}`);
  }
}

runScript('meta/sweep-duplicates', main);
