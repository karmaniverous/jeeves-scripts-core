/**
 * Tests for the modules split out of the meeting migrations:
 * meeting-alignment (migrate-alignment) and fathom-package-detect
 * (migrate-fathom), against temp meeting packages.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectFathomInPackage } from './fathom-package-detect.js';
import {
  inferDate,
  inferSource,
  isConformant,
  materializeArtifacts,
  readMeetingJson,
} from './meeting-alignment.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-pkg-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (name: string, content: string) => {
  fs.writeFileSync(path.join(dir, name), content);
};

describe('meeting-alignment', () => {
  it('reads meeting.json, or null when missing or invalid', () => {
    expect(readMeetingJson(dir)).toBeNull();
    put('meeting.json', '{bad');
    expect(readMeetingJson(dir)).toBeNull();
    put('meeting.json', '{"a":1}');
    expect(readMeetingJson(dir)).toEqual({ a: 1 });
  });

  it('flags metadata that does not match the canonical schema', () => {
    expect(isConformant({})).toBe(false);
  });

  it('infers the source from metadata, then the files present', () => {
    expect(inferSource({ source: 'zoom' }, dir)).toBe('zoom');
    expect(inferSource({ sources: [{ kind: 'gemini' }] }, dir)).toBe('gemini');
    expect(inferSource({}, dir)).toBe('unknown');
    put('gemini_link.txt', 'x');
    expect(inferSource({}, dir)).toBe('gemini');
    put('fathom-share.html', 'x');
    expect(inferSource({}, dir)).toBe('fathom');
  });

  it('infers the date from date, meetingDate, createdAt, then ingestedAt', () => {
    expect(inferDate({ date: '2026-01-02' }, 'm')).toBe('2026-01-02');
    expect(inferDate({ date: 'Jan 2', meetingDate: '2026-01-03' }, 'm')).toBe(
      '2026-01-03',
    );
    expect(inferDate({ createdAt: '2026-01-04T23:00:00Z' }, 'm')).toBe(
      '2026-01-04',
    );
    expect(
      inferDate({ createdAt: 'nope', ingestedAt: '2026-01-05T01:00:00Z' }, 'm'),
    ).toBe('2026-01-05');
  });

  it('materializes summary.txt from gemini-notes.txt for Gemini packages only', () => {
    put('gemini-notes.txt', 'notes');
    expect(materializeArtifacts(dir, 'fathom', 'b1')).toEqual({
      copied: [],
      changes: {},
    });
    expect(materializeArtifacts(dir, 'gemini', 'b1')).toEqual({
      copied: ['summary.txt'],
      changes: { 'summary.txt': 'materialized from gemini-notes.txt' },
    });
    expect(fs.readFileSync(path.join(dir, 'summary.txt'), 'utf8')).toBe(
      'notes',
    );
    // Never overwrites an existing summary.
    expect(materializeArtifacts(dir, 'gemini', 'b2').copied).toEqual([]);
  });
});

describe('detectFathomInPackage', () => {
  it('uses fathomUrl from the metadata first, inferring the kind', () => {
    expect(
      detectFathomInPackage(dir, {
        fathomUrl: 'https://fathom.video/share/abc',
      }),
    ).toEqual({ kind: 'share', url: 'https://fathom.video/share/abc' });
    expect(
      detectFathomInPackage(dir, {
        fathomUrl: 'https://fathom.video/calls/123',
        fathomKind: 'call',
      })?.kind,
    ).toBe('call');
  });

  it('then fathom_link.txt, then text and HTML artifacts', () => {
    expect(detectFathomInPackage(dir, {})).toBeNull();
    put('notes.html', '<a href="https://fathom.video/share/xyz">rec</a>');
    expect(detectFathomInPackage(dir, {})?.url).toContain('/share/xyz');
    put('fathom_link.txt', 'https://fathom.video/share/first\n');
    expect(detectFathomInPackage(dir, {})?.url).toContain('/share/first');
  });
});
