/**
 * Tests for the meta lifecycle jobs over a temp entity tree: disabling old
 * synthesised metas, and sweeping rejected and duplicate entities.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { disableOldMeta } from './disable-old-meta.js';
import { sweepDuplicates } from './sweep-duplicates.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
let root: string;
let lines: string[];

const entity = (
  name: string,
  meta: unknown,
  files: Record<string, string> = {},
) => {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.meta'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.meta', 'meta.json'),
    typeof meta === 'string' ? meta : JSON.stringify(meta),
  );
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
};
const readMeta = (name: string) =>
  JSON.parse(
    fs.readFileSync(path.join(root, name, '.meta', 'meta.json'), 'utf8'),
  ) as Record<string, unknown>;

const types = [
  { subdir: 'meetings', rejectionKeys: ['nonmeeting'], maxAgeDays: 30 },
  { subdir: 'people', rejectionKeys: [], maxAgeDays: null },
];
const dirsOf = (subdir: string) =>
  subdir === 'meetings' ? [root, path.join(root, 'missing')] : [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('disableOldMeta', () => {
  it('disables synthesised metas past the age limit and counts every other case', () => {
    entity('old', { meetingDate: '2026-01-01', _content: 'x' });
    entity('header-date', { _content: '# Standup 2026-02-01\n...' });
    entity('recent', { date: '2026-05-25', _content: 'x' });
    entity('no-content', { date: '2026-01-01' });
    entity('no-date', { _content: 'no date here' });
    entity('done', { _disabled: true });
    entity('bad', '{oops');
    fs.mkdirSync(path.join(root, 'no-meta'));
    disableOldMeta({ entityTypes: types, entityDirs: dirsOf, now: () => NOW });
    expect(readMeta('old')._disabled).toBe(true);
    expect(readMeta('header-date')._disabled).toBe(true);
    expect(readMeta('recent')._disabled).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      entityType: 'meetings',
      maxAgeDays: 30,
      scanned: 7,
      disabled: 2,
      alreadyDisabled: 1,
      skippedNoContent: 1,
      skippedNoDate: 1,
      skippedRecent: 1,
      cutoffDate: '2026-05-02',
    });
  });
});

describe('sweepDuplicates', () => {
  it('deletes rejected entities and merges duplicates (by sibling id or path) into the original', () => {
    entity('rejected', { nonMeeting: true });
    const original = entity('orig', { title: 'o' }, { 'notes.md': 'original' });
    entity(
      'dup',
      { duplicateOf: 'orig' },
      { 'notes.md': 'dup copy', 'extra/transcript.md': 't' },
    );
    entity('dup2', { duplicate_of: original }, { 'more.md': 'm' });
    entity('dangling', { DuplicateOf: 'nowhere' });
    entity('self', { duplicateOf: 'self' });
    entity('plain', { title: 'p' });
    sweepDuplicates({ entityTypes: types, entityDirs: dirsOf });
    expect(fs.existsSync(path.join(root, 'rejected'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'dup'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'dup2'))).toBe(false);
    expect(fs.readFileSync(path.join(original, 'notes.md'), 'utf8')).toBe(
      'original',
    );
    expect(
      fs.readFileSync(path.join(original, 'extra', 'transcript.md'), 'utf8'),
    ).toBe('t');
    expect(fs.existsSync(path.join(original, 'more.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'self'))).toBe(true);
    expect(lines).toContain(
      `[skip] Root does not exist: ${path.join(root, 'missing')}`,
    );
    expect(lines).toContain(
      `[skip] Self-reference: ${path.join(root, 'self')}`,
    );
    expect(lines).toContain('Rejected entities removed: 1');
    expect(lines).toContain('Duplicates found: 4');
    expect(lines).toContain('Merged: 2');
    expect(lines).toContain('Files copied: 2');
    expect(lines).toContain('Directories deleted: 3');
    expect(lines).toContain('Errors: 1');
  });
});
