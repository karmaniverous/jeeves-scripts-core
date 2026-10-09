/**
 * @module migration-backup
 *
 * Migration backup utilities — back up files before overwriting
 * and write reversible change records per batch (spec section 3.6).
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ChangeRecord {
  meetingId: string;
  meetingDir: string;
  timestamp: string;
  filesBackedUp: string[];
  changes: Record<string, string>;
}

/**
 * Back up a file before overwriting. Creates a .migration-backup/
 * directory alongside the meeting directory.
 *
 * Returns true if the backup was created, false if the source
 * file did not exist.
 */
export function backupFile(
  meetingDir: string,
  filename: string,
  batchId: string,
): boolean {
  const sourcePath = path.join(meetingDir, filename);
  if (!fs.existsSync(sourcePath)) return false;

  const backupDir = path.join(meetingDir, '.migration-backup', batchId);
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, filename);
  fs.copyFileSync(sourcePath, backupPath);
  return true;
}

/**
 * Write a change record for a single meeting package in a batch.
 */
export function writeChangeRecord(
  meetingDir: string,
  batchId: string,
  record: ChangeRecord,
): void {
  const backupDir = path.join(meetingDir, '.migration-backup', batchId);
  fs.mkdirSync(backupDir, { recursive: true });

  const recordPath = path.join(backupDir, 'change-record.json');
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

/**
 * Generate a unique batch ID for a migration run.
 */
export function generateBatchId(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${ts}`;
}
