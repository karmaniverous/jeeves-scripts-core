import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ColdRow,
  decodeEventRow,
  readArchiveEvents,
  readColdEvents,
} from './schema-v23-payloads.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const z = (s: string) => zlib.zstdCompressSync(Buffer.from(s));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-payloads-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('decodeEventRow', () => {
  it('returns inline JSON, or the decoded zstd payload', () => {
    expect(
      decodeEventRow({
        event_json: '{"a":1}',
        event_zstd: null,
        event_utf8_bytes: null,
      }),
    ).toBe('{"a":1}');
    const text = '{"b":2}';
    expect(
      decodeEventRow({
        event_json: null,
        event_zstd: z(text),
        event_utf8_bytes: text.length,
      }),
    ).toBe(text);
  });

  it('rejects bad bounds and a length mismatch', () => {
    expect(() =>
      decodeEventRow({
        event_json: null,
        event_zstd: null,
        event_utf8_bytes: 3,
      }),
    ).toThrow('Invalid compressed transcript payload bounds');
    expect(() =>
      decodeEventRow({
        event_json: null,
        event_zstd: z('abcd'),
        event_utf8_bytes: 0,
      }),
    ).toThrow('bounds');
    expect(() =>
      decodeEventRow({
        event_json: null,
        event_zstd: z('abcd'),
        event_utf8_bytes: 5,
      }),
    ).toThrow('does not match event_utf8_bytes');
  });
});

describe('readColdEvents', () => {
  const archive = (lines: unknown[]) =>
    z(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const row = (blob: Uint8Array, over: Partial<ColdRow> = {}): ColdRow => ({
    session_id: 's1',
    generation: 'g',
    archive_name: 'a.jsonl.zst',
    archive_sha256: sha(blob),
    event_count: 2,
    archive_bytes: blob.length,
    last_seq: 2,
    storage: 'sqlite',
    archive_blob: blob,
    ...over,
  });
  const good = [
    { kind: 'header', sessionId: 's1' },
    { kind: 'event', row: { seq: 1, event_json: '{}' } },
    { kind: 'other' },
    { kind: 'event', row: { seq: 2, event_json: '{"x":1}' } },
  ];

  it('reads the events of a blob archive and of a file archive', () => {
    const blob = archive(good);
    expect(readColdEvents(row(blob), { artifactDir: dir })).toEqual([
      { seq: 1, json: '{}' },
      { seq: 2, json: '{"x":1}' },
    ]);
    const name = `${'a'.repeat(64)}.jsonl.zst`;
    fs.mkdirSync(path.join(dir, 'cold'));
    fs.writeFileSync(path.join(dir, 'cold', name), blob);
    expect(
      readColdEvents(
        row(blob, { storage: 'file', archive_name: name, archive_blob: null }),
        { artifactDir: dir },
      ),
    ).toHaveLength(2);
  });

  it.each([
    [
      'a missing blob',
      row(Buffer.from(''), { archive_blob: null }),
      'Cold archive blob missing',
    ],
    [
      'a bad file name',
      row(Buffer.from(''), { storage: 'file', archive_name: '../x' }),
      'Invalid cold archive name',
    ],
    [
      'a checksum failure',
      row(archive(good), { archive_sha256: 'bad' }),
      'failed verification',
    ],
    [
      'a header for another session',
      row(archive([{ kind: 'header', sessionId: 'other' }])),
      'header mismatch',
    ],
    [
      'a malformed event',
      row(archive([good[0], { kind: 'event', row: { seq: 'x' } }])),
      'malformed event',
    ],
    [
      'a count mismatch',
      row(archive(good), { event_count: 3 }),
      'metadata mismatch',
    ],
  ])('rejects %s', (_name, r, message) => {
    expect(() => readColdEvents(r, { artifactDir: dir })).toThrow(message);
  });
});

describe('readArchiveEvents', () => {
  const lines = ['{"type":"session","id":"s1"}', '{"type":"message"}', ''].join(
    '\n',
  );

  it('reads plain and zstd archives', () => {
    const plain = Buffer.from(lines);
    expect(
      readArchiveEvents({
        session_id: 's1',
        archive_name: 'p',
        encoding: 'none',
        archive_blob: plain,
        archive_sha256: sha(plain),
      }),
    ).toEqual([
      { seq: 0, json: '{"type":"session","id":"s1"}' },
      { seq: 1, json: '{"type":"message"}' },
    ]);
    const packed = z(lines);
    expect(
      readArchiveEvents({
        session_id: 's1',
        archive_name: 'z',
        encoding: 'zstd',
        archive_blob: packed,
        archive_sha256: sha(packed),
      }),
    ).toHaveLength(2);
  });

  it('rejects a checksum failure, an empty archive and a header mismatch', () => {
    const plain = Buffer.from(lines);
    expect(() =>
      readArchiveEvents({
        session_id: 's1',
        archive_name: 'p',
        encoding: 'none',
        archive_blob: plain,
        archive_sha256: 'x',
      }),
    ).toThrow('failed verification');
    const empty = Buffer.from('');
    expect(() =>
      readArchiveEvents({
        session_id: 's1',
        archive_name: 'e',
        encoding: 'none',
        archive_blob: empty,
        archive_sha256: sha(empty),
      }),
    ).toThrow('header mismatch');
    expect(() =>
      readArchiveEvents({
        session_id: 's2',
        archive_name: 'p',
        encoding: 'none',
        archive_blob: plain,
        archive_sha256: sha(plain),
      }),
    ).toThrow('header mismatch');
  });
});
