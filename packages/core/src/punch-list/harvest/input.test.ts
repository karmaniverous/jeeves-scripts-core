import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hasNewInput, readCursor, writeCursor } from './input.js';

describe('input', () => {
  it('round-trips the cursor and detects new files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-input-'));
    const cursor = join(dir, 'state', 'cursor.json');
    expect(readCursor(cursor)).toBeUndefined();
    writeCursor(cursor, new Date('2026-10-18T00:00:00Z'));
    expect(readCursor(cursor)?.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    const content = join(dir, 'content', 'slack');
    mkdirSync(join(content, '.meta'), { recursive: true });
    writeFileSync(join(content, '.meta', 'x.json'), '{}');
    const file = join(content, 'm.json');
    writeFileSync(file, '{}');
    utimesSync(
      file,
      new Date('2026-10-17T00:00:00Z'),
      new Date('2026-10-17T00:00:00Z'),
    );
    expect(
      hasNewInput(
        [content, join(dir, 'missing')],
        new Date('2026-10-17T12:00:00Z'),
      ),
    ).toBe(false);
    expect(hasNewInput([content], new Date('2026-10-16T12:00:00Z'))).toBe(true);
  });

  it('counts a file root by its own modification time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pl-input-'));
    const issues = join(dir, 'issues.json');
    writeFileSync(issues, '{}');
    utimesSync(
      issues,
      new Date('2026-10-17T00:00:00Z'),
      new Date('2026-10-17T00:00:00Z'),
    );
    expect(hasNewInput([issues], new Date('2026-10-17T12:00:00Z'))).toBe(false);
    expect(hasNewInput([issues], new Date('2026-10-16T12:00:00Z'))).toBe(true);
  });
});

describe('hasNewInput and dot entries', () => {
  it('ignores dot entries and descends into other directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'pl-dot-'));
    const old = new Date('2026-01-01T00:00:00Z');
    mkdirSync(join(root, '.meta'), { recursive: true });
    writeFileSync(join(root, '.meta', 'meta.json'), '{}');
    writeFileSync(join(root, '.lock'), '');
    writeFileSync(join(root, 'old.json'), '{}');
    utimesSync(join(root, 'old.json'), old, old);
    const since = new Date('2026-06-01T00:00:00Z');
    expect(hasNewInput([root], since)).toBe(false);
    mkdirSync(join(root, 'sub', 'deeper'), { recursive: true });
    expect(hasNewInput([root], since)).toBe(false);
    writeFileSync(join(root, 'sub', 'deeper', 'new.json'), '{}');
    expect(hasNewInput([root], since)).toBe(true);
  });
});
