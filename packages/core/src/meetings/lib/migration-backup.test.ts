import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  backupFile,
  generateBatchId,
  writeChangeRecord,
} from './migration-backup.js';

describe('backupFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a backup of an existing file', () => {
    fs.writeFileSync(path.join(tmpDir, 'meeting.json'), '{"test":true}');
    const result = backupFile(tmpDir, 'meeting.json', 'batch-001');
    expect(result).toBe(true);

    const backupPath = path.join(
      tmpDir,
      '.migration-backup',
      'batch-001',
      'meeting.json',
    );
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, 'utf8')).toBe('{"test":true}');
  });

  it('returns false for non-existent file', () => {
    const result = backupFile(tmpDir, 'missing.json', 'batch-001');
    expect(result).toBe(false);
  });
});

describe('writeChangeRecord', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a change record JSON', () => {
    writeChangeRecord(tmpDir, 'batch-001', {
      meetingId: 'test',
      meetingDir: tmpDir,
      timestamp: '2026-04-09T12:00:00Z',
      filesBackedUp: ['meeting.json'],
      changes: { 'meeting.json': 'updated metadata' },
    });

    const recordPath = path.join(
      tmpDir,
      '.migration-backup',
      'batch-001',
      'change-record.json',
    );
    expect(fs.existsSync(recordPath)).toBe(true);

    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(record.meetingId).toBe('test');
    expect(record.filesBackedUp).toEqual(
      expect.arrayContaining(['meeting.json']),
    );
  });
});

describe('generateBatchId', () => {
  it('generates a string with the given prefix', () => {
    const id = generateBatchId('alignment');
    expect(id).toMatch(/^alignment-/);
  });

  it('embeds an ISO-ish timestamp after the prefix', () => {
    const id = generateBatchId('alignment');
    // Format: prefix-YYYY-MM-DDTHH-MM-SS-mmmZ
    const after = id.slice('alignment-'.length);
    expect(after).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  });
});
