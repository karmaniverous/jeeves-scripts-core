/**
 * Tests for the archive reader: channel directories across roots (first
 * wins), only newer message files parsed, bad files skipped, and the
 * node file access.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { indexArchive, nodeArchiveFs, readArchivedSince } from './archive.js';
import {
  human,
  memoryArchiveFs,
  messageJson,
  ts,
} from './fakes.test-helper.js';

const io = memoryArchiveFs({
  '/a/slack/general (C1)/1.000100.json': '{}',
  '/a/slack/dm-x (D9)/1.000100.json': '{}',
  '/a/slack/no-id/1.000100.json': '{}',
  '/b/slack/general-renamed (C1)/1.000100.json': '{}',
  '/b/slack/private (G2)/1.000100.json': '{}',
});

describe('indexArchive', () => {
  it('maps ids to directories, first root first, missing roots skipped', () => {
    const dirs = indexArchive(['/a/slack', '/missing', '/b/slack'], io);
    expect([...dirs.keys()].sort()).toEqual(['C1', 'D9', 'G2']);
    expect(dirs.get('C1')).toBe(path.join('/a/slack', 'general (C1)'));
    expect(dirs.get('G2')).toBe(path.join('/b/slack', 'private (G2)'));
  });
});

describe('readArchivedSince', () => {
  const dir = '/arch/general (C1)';
  const files = memoryArchiveFs({
    [`${dir}/${ts(30)}.json`]: messageJson(human(30, 'third')),
    // Current archive format: a configured person's name is a string.
    [`${dir}/${ts(10)}.json`]: messageJson({
      ...human(10, 'first'),
      userName: 'Ann Lee',
    }),
    [`${dir}/${ts(20)}.json`]: messageJson(human(20, 'second')),
    [`${dir}/${ts(40)}.json`]: 'not json',
    [`${dir}/${ts(50)}.json`]: '{"ts":"bad"}',
    [`${dir}/notes.txt`]: 'x',
    [`${dir}/.meta/meta.json`]: '{}',
  });

  it('reads every message oldest first, skipping bad files', () => {
    expect(readArchivedSince(dir, undefined, files).map((m) => m.text)).toEqual(
      ['first', 'second', 'third'],
    );
  });

  it('reads only files newer than the bound', () => {
    expect(readArchivedSince(dir, ts(10), files).map((m) => m.text)).toEqual([
      'second',
      'third',
    ]);
  });

  it('skips a file that disappears mid-read', () => {
    const flaky = { ...files, readText: () => undefined };
    expect(readArchivedSince(dir, undefined, flaky)).toEqual([]);
  });

  it('reads nothing from a missing directory', () => {
    expect(readArchivedSince('/nowhere', undefined, files)).toEqual([]);
  });
});

describe('nodeArchiveFs', () => {
  it('reads real files and reports missing ones as undefined', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-meta-fs-'));
    try {
      fs.writeFileSync(path.join(root, 'a.json'), 'x');
      expect(nodeArchiveFs.readdir(root)).toEqual(['a.json']);
      expect(nodeArchiveFs.readText(path.join(root, 'a.json'))).toBe('x');
      expect(nodeArchiveFs.exists(root)).toBe(true);
      expect(nodeArchiveFs.readdir(path.join(root, 'none'))).toBeUndefined();
      expect(nodeArchiveFs.readText(path.join(root, 'none'))).toBeUndefined();
      expect(nodeArchiveFs.exists(path.join(root, 'none'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
