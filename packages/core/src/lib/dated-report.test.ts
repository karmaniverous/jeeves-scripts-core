/**
 * Tests for dated report files: the calendar date in a zone, and
 * delivery to `<outputDir>/<date>.md`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { dateInZone, deliverReport, reportPath } from './dated-report.js';

describe('dateInZone', () => {
  it('formats the calendar date in the zone', () => {
    const now = new Date('2026-10-20T20:00:00Z');
    expect(dateInZone(now, 'UTC')).toBe('2026-10-20');
    expect(dateInZone(now, 'Asia/Makassar')).toBe('2026-10-21');
  });
});

describe('deliverReport', () => {
  let dir = '';

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes <outputDir>/<date>.md, creating the directory and replacing an older one', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dated-report-'));
    const out = path.join(dir, 'nested');
    const file = deliverReport(out, '2026-10-20', 'first');
    expect(file).toBe(reportPath(out, '2026-10-20'));
    expect(fs.readFileSync(file, 'utf8')).toBe('first\n');
    deliverReport(out, '2026-10-20', 'second\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('second\n');
    expect(fs.readdirSync(out)).toEqual(['2026-10-20.md']);
  });
});
